# Generates a styled PDF of the CU-Connect deployment guide (from the chat).
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Preformatted, HRFlowable,
)

OUT = r"D:\Vibe Coding\2\CU - Connect\CU-Connect_Deployment_Guide.pdf"

BLUE = colors.HexColor("#1f4e96")
DARK = colors.HexColor("#222222")
GREYBG = colors.HexColor("#f2f4f8")
BORDER = colors.HexColor("#c9d2e0")

ss = getSampleStyleSheet()
styles = {
    "title": ParagraphStyle("title", parent=ss["Title"], textColor=BLUE, fontSize=22, spaceAfter=4),
    "sub": ParagraphStyle("sub", parent=ss["Normal"], fontSize=10.5, textColor=DARK, spaceAfter=10, leading=15),
    "h2": ParagraphStyle("h2", parent=ss["Heading2"], textColor=BLUE, fontSize=14, spaceBefore=14, spaceAfter=6),
    "body": ParagraphStyle("body", parent=ss["Normal"], fontSize=10, textColor=DARK, leading=15, spaceAfter=6),
    "li": ParagraphStyle("li", parent=ss["Normal"], fontSize=10, textColor=DARK, leading=15,
                         leftIndent=12, bulletIndent=2, spaceAfter=3),
    "note": ParagraphStyle("note", parent=ss["Normal"], fontSize=9.5, textColor=colors.HexColor("#555555"),
                           leading=14, leftIndent=8, spaceAfter=6),
    "code": ParagraphStyle("code", parent=ss["Code"], fontSize=8.5, textColor=colors.HexColor("#0b2545"),
                           leading=12, backColor=GREYBG, borderPadding=6, spaceBefore=2, spaceAfter=8),
    "cellh": ParagraphStyle("cellh", parent=ss["Normal"], fontSize=9, textColor=colors.white, leading=12),
    "cell": ParagraphStyle("cell", parent=ss["Normal"], fontSize=9, textColor=DARK, leading=12),
    "cellc": ParagraphStyle("cellc", parent=ss["Code"], fontSize=8, textColor=colors.HexColor("#0b2545"), leading=11),
}

story = []

def h2(t): story.append(Paragraph(t, styles["h2"]))
def body(t): story.append(Paragraph(t, styles["body"]))
def li(t): story.append(Paragraph("• " + t, styles["li"]))
def note(t): story.append(Paragraph(t, styles["note"]))
def code(t): story.append(Preformatted(t, styles["code"]))
def gap(h=4): story.append(Spacer(1, h))
def rule(): story.append(HRFlowable(width="100%", thickness=0.6, color=BORDER, spaceBefore=8, spaceAfter=8))

def table(headers, rows, colw):
    data = [[Paragraph(h, styles["cellh"]) for h in headers]]
    for r in rows:
        data.append([Paragraph(c, styles["cellc"] if mono else styles["cell"]) for c, mono in r])
    t = Table(data, colWidths=colw, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, GREYBG]),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    gap(8)

# ---- Header ----
story.append(Paragraph("CU-Connect — Going Live", styles["title"]))
story.append(Paragraph(
    "Step-by-step production deployment: <b>MongoDB Atlas</b> (database) → "
    "<b>Render</b> (Express + Socket.IO backend) → <b>Vercel</b> (static frontend).",
    styles["sub"]))
rule()

# ---- Phase 0 ----
h2("Phase 0 — Get the code on GitHub")
body("Render and Vercel deploy from git. From <font face='Courier'>D:\\Vibe Coding\\2\\CU - Connect</font>:")
code('cd "D:/Vibe Coding/2/CU - Connect"\n'
     'git init\n'
     'git add .\n'
     'git commit -m "CU-Connect production build"')
body("Create an empty repo on github.com (e.g. <font face='Courier'>cu-connect</font>), then:")
code('git remote add origin https://github.com/<you>/cu-connect.git\n'
     'git branch -M main\n'
     'git push -u origin main')
note("<b>Important:</b> push the <i>CU - Connect</i> folder itself as the repo root, so the repo contains "
     "Backend/ and Frontend/ at the top level. .gitignore already excludes node_modules and .env — "
     "never commit those.")

# ---- Phase 1 ----
h2("Phase 1 — MongoDB Atlas (database)")
li("Sign up at mongodb.com/cloud/atlas → <b>Create</b> a free <b>M0</b> cluster (region near your users).")
li("<b>Database Access</b> → Add New Database User → username + strong password. Role: Read and write to any database.")
li("<b>Network Access</b> → Add IP Address → <b>Allow access from anywhere</b> (0.0.0.0/0). Render IPs are dynamic, so this is required on the free tier.")
li("<b>Database → Connect → Drivers</b> → copy the connection string, insert your password, and add the DB name <font face='Courier'>cu-connect</font> before the '?':")
code("mongodb+srv://myuser:mypass@cluster0.xxxxx.mongodb.net/cu-connect?retryWrites=true&w=majority")
body("Keep this — it is your <b>MONGODB_URI</b>.")

# ---- Phase 2 ----
h2("Phase 2 — Render (backend: Express + Socket.IO)")
li("Sign up at render.com, connect GitHub.")
li("<b>New → Web Service</b> → pick your repo.")
body("Settings:")
li("<b>Root Directory:</b> <font face='Courier'>Backend</font>")
li("<b>Runtime:</b> Node &nbsp; <b>Build:</b> <font face='Courier'>npm install</font> &nbsp; <b>Start:</b> <font face='Courier'>npm start</font>")
li("<b>Instance Type:</b> Free &nbsp; <b>Health Check Path:</b> <font face='Courier'>/healthz</font>")
body("<b>Environment Variables</b>:")
table(
    ["Key", "Value"],
    [
        [("NODE_ENV", True), ("production", True)],
        [("JWT_SECRET", True), ('node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"', True)],
        [("MONGODB_URI", True), ("your Atlas string from Phase 1", False)],
        [("IDE_ENABLED", True), ("false", True)],
        [("CORS_ORIGINS", True), ("leave blank for now — filled in Phase 4", False)],
    ],
    [38 * mm, 120 * mm],
)
li("<b>Create Web Service.</b> Wait for green. Copy the URL, e.g. https://cu-connect-backend.onrender.com.")
li("Test: open <font face='Courier'>/healthz</font> → returns {\"ok\":true,\"ide\":false}. The DB auto-seeds on first boot.")
note("The Backend/render.yaml blueprint automates this via 'New → Blueprint', but its rootDir assumes a parent "
     "folder. The manual steps above are the reliable path.")

# ---- Phase 3 ----
h2("Phase 3 — Vercel (frontend: static HTML)")
li("Sign up at vercel.com, connect GitHub.")
li("<b>Add New → Project</b> → pick your repo.")
li("<b>Root Directory:</b> <font face='Courier'>Frontend/Landing Page</font> (click Edit and select it).")
li("<b>Framework Preset:</b> Other. Leave build/output empty (static HTML).")
li("<b>Deploy.</b> Copy the URL, e.g. https://cu-connect.vercel.app.")
note("The site loads but login will fail — the frontend is still same-origin. Fixed in Phase 4.")

# ---- Phase 4 ----
h2("Phase 4 — Wire the two origins together")
body("<b>a) Point the frontend at the backend.</b> Edit <font face='Courier'>Frontend/Landing Page/config.js</font>:")
code("window.CUCONNECT = {\n"
     "  API_BASE: 'https://cu-connect-backend.onrender.com',\n"
     "  SOCKET_URL: 'https://cu-connect-backend.onrender.com',\n"
     "};")
body("Commit and push — Vercel auto-redeploys:")
code('git commit -am "Point frontend at Render backend"\ngit push')
body("<b>b) Allow the frontend origin on the backend.</b> In Render → Environment, set:")
code("CORS_ORIGINS = https://cu-connect.vercel.app")
body("Add custom domains too, comma-separated, no trailing slash. Save → Render redeploys automatically.")

# ---- Phase 5 ----
h2("Phase 5 — Verify live")
li("Open your Vercel URL → login.html.")
li("Log in with a seeded demo account: pallakshi@chitkara.edu.in / password123.")
li("Check the dashboard loads (attendance %, CGPA). Open a teacher session "
   "(rajesh@chitkara.edu.in) in another browser, mark attendance, and confirm the student view "
   "updates live — that proves Socket.IO + CORS work across origins.")

# ---- Notes ----
h2("Free-tier notes")
li("<b>Render spins down after ~15 min idle.</b> First request after that takes ~30–50s (cold start); "
   "Socket.IO reconnects once up. Upgrade the instance or add an uptime pinger to stay hot.")
li("<b>IDE stays disabled</b> (IDE_ENABLED=false). /api/execute returns 503 by design — the local runner is "
   "unsandboxed. Wire lib/runner.js to a hosted Judge0/Docker sandbox before enabling.")
li("<b>Re-seeding:</b> the DB seeds only when empty. To reset demo data, drop the cu-connect database in Atlas "
   "and restart the Render service.")
li("<b>Never commit .env</b> — it is gitignored. All secrets live in the Render dashboard.")

doc = SimpleDocTemplate(OUT, pagesize=A4,
                        leftMargin=18 * mm, rightMargin=18 * mm,
                        topMargin=16 * mm, bottomMargin=16 * mm,
                        title="CU-Connect Deployment Guide")
doc.build(story)
print("Wrote", OUT)
