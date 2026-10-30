import os, secrets, hashlib, re, io
from pathlib import Path
from functools import wraps
from datetime import datetime, timezone
from flask import Flask, g, session, request, redirect, url_for, render_template, flash, abort, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from psycopg import connect as pg_connect

BASE=Path(__file__).resolve().parent
DATABASE_URL=os.environ.get("DATABASE_URL", "").strip()
MAX_MB=int(os.environ.get("VOXORA_MAX_UPLOAD_MB","20"))
ALLOWED={"pdf","docx","pptx","txt","md","rtf","csv","odt","ods","odp"}
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required. Configure your Neon PostgreSQL connection string.")
app=Flask(__name__)
app.config.update(SECRET_KEY=os.environ.get("VOXORA_SECRET_KEY") or secrets.token_hex(32),
 MAX_CONTENT_LENGTH=MAX_MB*1024*1024, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
 SESSION_COOKIE_SECURE=os.environ.get("VOXORA_HTTPS","1")=="1")

class HybridRow(dict):
    def __getitem__(self, key):
        if isinstance(key, int): return list(self.values())[key]
        return super().__getitem__(key)

def hybrid_row_factory(cursor):
    # PostgreSQL DDL/command statements (e.g. CREATE TABLE) have no result columns.
    # psycopg still asks the row factory for a callable, so handle a missing description.
    description = cursor.description
    names = [column.name for column in description] if description is not None else []
    def make_row(values): return HybridRow(zip(names, values))
    return make_row

def conn():
    return pg_connect(DATABASE_URL, sslmode="require", row_factory=hybrid_row_factory)
def now(): return datetime.now(timezone.utc).isoformat(timespec="seconds")
def init():
 c=conn()
 try:
  c.execute("""
  CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS resources(id BIGSERIAL PRIMARY KEY,owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',original_name TEXT NOT NULL,stored_name TEXT UNIQUE NOT NULL,extension TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes BIGINT NOT NULL,sha256 TEXT NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN ('public','private')),extracted_text TEXT NOT NULL DEFAULT '',file_data BYTEA NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS shares(resource_id BIGINT REFERENCES resources(id) ON DELETE CASCADE,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(resource_id,user_id));
  CREATE TABLE IF NOT EXISTS library(user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,resource_id BIGINT REFERENCES resources(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,resource_id));
  CREATE INDEX IF NOT EXISTS idx_resources_public ON resources(visibility,created_at);
  CREATE INDEX IF NOT EXISTS idx_resources_sha256 ON resources(sha256);
  """)
  c.commit()
 finally:
  c.close()
init()
def db():
 if "db" not in g: g.db=conn()
 return g.db
@app.teardown_appcontext
def close_db(e=None):
 c=g.pop("db",None)
 if c: c.close()
def user():
 uid=session.get("uid")
 return db().execute("SELECT id,name,email FROM users WHERE id=%s",(uid,)).fetchone() if uid else None
@app.context_processor
def globals_for_templates(): return {"current_user":user()}
def login_required(fn):
 @wraps(fn)
 def wrapped(*a,**kw):
  if not user(): flash("Please sign in to continue.","info"); return redirect(url_for("signin",next=request.path))
  return fn(*a,**kw)
 return wrapped
def csrf():
 if "_csrf" not in session: session["_csrf"]=secrets.token_urlsafe(32)
 return session["_csrf"]
app.jinja_env.globals["csrf_token"]=csrf
@app.before_request
def check_csrf():
 if request.method=="POST":
  supplied=request.form.get("_csrf_token",""); expected=session.get("_csrf","")
  if not supplied or not expected or not secrets.compare_digest(supplied,expected): abort(400,"Form security token missing or expired.")
def accessible(r,u):
 if r["visibility"]=="public": return True
 if not u: return False
 if r["owner_id"]==u["id"]: return True
 return bool(db().execute("SELECT 1 FROM shares WHERE resource_id=%s AND user_id=%s",(r["id"],u["id"])).fetchone())
def resource(rid):
 r=db().execute("SELECT r.*,u.name owner_name FROM resources r JOIN users u ON u.id=r.owner_id WHERE r.id=%s",(rid,)).fetchone()
 if not r: abort(404)
 return r
def extract(data,ext):
 try:
  stream=io.BytesIO(data)
  if ext in {"txt","md","csv"}: return data.decode("utf-8",errors="replace")[:500000]
  if ext=="rtf":
   text=data.decode("utf-8",errors="replace"); text=re.sub(r"\\[a-zA-Z]+-?\d* ?"," ",text); return re.sub(r"\s+"," ",text.replace("{"," ").replace("}"," "))[:500000]
  if ext=="pdf":
   from pypdf import PdfReader
   return "\n\n".join(p.extract_text() or "" for p in PdfReader(stream).pages)[:500000]
  if ext=="docx":
   from docx import Document
   d=Document(stream); parts=[p.text for p in d.paragraphs if p.text.strip()]
   for t in d.tables:
    for row in t.rows: parts.append(" | ".join(c.text.strip() for c in row.cells))
   return "\n\n".join(parts)[:500000]
  if ext=="pptx":
   from pptx import Presentation
   parts=[]
   for n,slide in enumerate(Presentation(stream).slides,1):
    parts.append(f"Slide {n}")
    for sh in slide.shapes:
     if getattr(sh,"has_text_frame",False) and sh.text.strip(): parts.append(sh.text.strip())
     if getattr(sh,"has_table",False):
      for row in sh.table.rows: parts.append(" | ".join(c.text.strip() for c in row.cells))
   return "\n\n".join(parts)[:500000]
 except Exception: return ""
 return ""
@app.route("/")
def index():
 q=request.args.get("q","").strip()[:100]
 sql="SELECT r.id,r.title,r.description,r.extension,r.size_bytes,u.name owner_name FROM resources r JOIN users u ON u.id=r.owner_id WHERE r.visibility='public'"
 p=[]
 if q:
  sql+=" AND (r.title ILIKE %s OR r.description ILIKE %s OR r.extracted_text ILIKE %s)"; t="%"+q+"%"; p=[t,t,t]
 rows=db().execute(sql+" ORDER BY r.created_at DESC LIMIT 60",p).fetchall()
 return render_template("index.html",resources=rows,query=q)
@app.route("/register",methods=["GET","POST"])
def register():
 if request.method=="POST":
  name=request.form.get("name","").strip()[:80]; email=request.form.get("email","").strip().lower()[:254]; pw=request.form.get("password","")
  if not name or not email or len(pw)<10: flash("Enter your name and email, and use a password of at least 10 characters.","error"); return render_template("auth.html",mode="register")
  try:
   db().execute("INSERT INTO users(name,email,password_hash,created_at) VALUES(%s,%s,%s,%s)",(name,email,generate_password_hash(pw),now())); db().commit()
  except Exception as exc:
   db().rollback()
   if "unique" not in str(exc).lower(): raise
   flash("An account with that email already exists.","error")
   return render_template("auth.html",mode="register")
  uid=db().execute("SELECT id FROM users WHERE email=%s",(email,)).fetchone()["id"]; session.clear(); session["uid"]=uid
  flash("Welcome to Voxora Access. Your account is ready.","success"); return redirect(url_for("index"))
 return render_template("auth.html",mode="register")
@app.route("/signin",methods=["GET","POST"])
def signin():
 if request.method=="POST":
  email=request.form.get("email","").strip().lower(); pw=request.form.get("password","")
  u=db().execute("SELECT * FROM users WHERE email=%s",(email,)).fetchone()
  if not u or not check_password_hash(u["password_hash"],pw): flash("Email or password was not recognised.","error"); return render_template("auth.html",mode="signin")
  session.clear(); session["uid"]=u["id"]; flash("You are signed in.","success")
  dest=request.args.get("next",""); return redirect(dest if dest.startswith("/") and not dest.startswith("//") else url_for("index"))
 return render_template("auth.html",mode="signin")
@app.post("/signout")
@login_required
def signout(): session.clear(); flash("You have signed out.","info"); return redirect(url_for("index"))
@app.route("/upload",methods=["GET","POST"])
@login_required
def upload():
 if request.method=="POST":
  f=request.files.get("file"); title=request.form.get("title","").strip()[:160]; desc=request.form.get("description","").strip()[:1000]; vis=request.form.get("visibility","public")
  if vis not in {"public","private"}: vis="public"
  if not f or not f.filename: flash("Choose a file to upload.","error"); return render_template("upload.html")
  original=secure_filename(f.filename)
  if not original or "." not in original or original.rsplit(".",1)[1].lower() not in ALLOWED: flash("That file type is not supported.","error"); return render_template("upload.html")
  ext=original.rsplit(".",1)[1].lower(); stored=secrets.token_hex(16)+"."+ext; file_data=f.read()
  if not file_data: flash("The selected file is empty.","error"); return render_template("upload.html")
  digest=hashlib.sha256(file_data).hexdigest(); uid=user()["id"]
  dup=db().execute("SELECT id FROM resources WHERE sha256=%s AND (owner_id=%s OR visibility='public' OR id IN (SELECT resource_id FROM shares WHERE user_id=%s)) LIMIT 1",(digest,uid,uid)).fetchone()
  if dup: flash("A matching file is already available to you.","info"); return redirect(url_for("detail",rid=dup["id"]))
  try:
   db().execute("INSERT INTO resources(owner_id,title,description,original_name,stored_name,extension,mime_type,size_bytes,sha256,visibility,extracted_text,file_data,created_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",(uid,title or Path(original).stem,desc,original,stored,ext,f.mimetype or "application/octet-stream",len(file_data),digest,vis,extract(file_data,ext),file_data,now())); db().commit()
  except Exception: db().rollback(); raise
  flash("Your resource has been uploaded.","success"); return redirect(url_for("my_resources"))
 return render_template("upload.html")
@app.route("/resource/<int:rid>")
def detail(rid):
 r=resource(rid)
 if not accessible(r,user()): abort(404)
 return render_template("resource.html",resource=r)
@app.route("/resource/<int:rid>/download")
def download(rid):
 r=resource(rid)
 if not accessible(r,user()): abort(404)
 if r["file_data"] is None: abort(404)
 return send_file(io.BytesIO(bytes(r["file_data"])),mimetype=r["mime_type"],as_attachment=True,download_name=r["original_name"])
@app.route("/resource/<int:rid>/read")
def read(rid):
 r=resource(rid)
 if not accessible(r,user()): abort(404)
 return render_template("read.html",resource=r)
@app.route("/my-resources")
@login_required
def my_resources():
 rows=db().execute("SELECT * FROM resources WHERE owner_id=%s ORDER BY created_at DESC",(user()["id"],)).fetchall()
 return render_template("my_resources.html",resources=rows)
@app.post("/resource/<int:rid>/delete")
@login_required
def delete(rid):
 r=resource(rid)
 if r["owner_id"]!=user()["id"]: abort(404)
 db().execute("DELETE FROM resources WHERE id=%s",(rid,)); db().commit()
 flash("Resource deleted.","success"); return redirect(url_for("my_resources"))
@app.post("/resource/<int:rid>/share")
@login_required
def share(rid):
 r=resource(rid)
 if r["owner_id"]!=user()["id"]: abort(404)
 target=db().execute("SELECT id FROM users WHERE email=%s",(request.form.get("email","").strip().lower(),)).fetchone()
 if not target: flash("No Voxora Access account was found for that email.","error")
 elif target["id"]==user()["id"]: flash("This resource is already in your account.","info")
 else:
  db().execute("INSERT INTO shares(resource_id,user_id,created_at) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING",(rid,target["id"],now())); db().commit(); flash("Resource access shared.","success")
 return redirect(url_for("detail",rid=rid))
@app.post("/resource/<int:rid>/library")
@login_required
def library_toggle(rid):
 r=resource(rid)
 if not accessible(r,user()): abort(404)
 uid=user()["id"]; exists=db().execute("SELECT 1 FROM library WHERE user_id=%s AND resource_id=%s",(uid,rid)).fetchone()
 if exists: db().execute("DELETE FROM library WHERE user_id=%s AND resource_id=%s",(uid,rid)); flash("Removed from My Library.","info")
 else: db().execute("INSERT INTO library(user_id,resource_id,created_at) VALUES(%s,%s,%s)",(uid,rid,now())); flash("Added to My Library.","success")
 db().commit(); return redirect(url_for("library_page"))
@app.route("/library")
@login_required
def library_page():
 rows=db().execute("SELECT r.*,u.name owner_name FROM library l JOIN resources r ON r.id=l.resource_id JOIN users u ON u.id=r.owner_id WHERE l.user_id=%s ORDER BY l.created_at DESC",(user()["id"],)).fetchall()
 return render_template("library.html",resources=[r for r in rows if accessible(r,user())])
@app.route("/shared-with-me")
@login_required
def shared_page():
 rows=db().execute("SELECT r.*,u.name owner_name FROM shares s JOIN resources r ON r.id=s.resource_id JOIN users u ON u.id=r.owner_id WHERE s.user_id=%s ORDER BY s.created_at DESC",(user()["id"],)).fetchall()
 return render_template("shared.html",resources=rows)
@app.route("/preferences")
@login_required
def preferences(): return render_template("preferences.html")
@app.route("/privacy")
def privacy(): return render_template("privacy.html")
@app.route("/accessibility")
def accessibility(): return render_template("accessibility.html")
@app.errorhandler(413)
def too_large(e): flash(f"Files must be {MAX_MB} MB or smaller.","error"); return redirect(url_for("upload"))
if __name__=="__main__": app.run(host="0.0.0.0",port=int(os.environ.get("PORT","5000")),debug=os.environ.get("VOXORA_DEBUG","0")=="1")
