# Generates a PDF of the CU-Connect production/MongoDB/Vercel assessment.
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)

OUT = "CU-Connect_Production_Assessment.pdf"

ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Heading1"], fontSize=18, spaceAfter=6,
                    textColor=colors.HexColor("#1a3d7c"))
H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontSize=13, spaceBefore=12,
                    spaceAfter=4, textColor=colors.HexColor("#1a3d7c"))
BODY = ParagraphStyle("BODY", parent=ss["BodyText"], fontSize=10, leading=14,
                      spaceAfter=5)
SMALL = ParagraphStyle("SMALL", parent=BODY, fontSize=8.5, leading=11)
BULLET = ParagraphStyle("BULLET", parent=BODY, leftIndent=12, bulletIndent=2,
                        spaceAfter=2)

story = []


def h1(t): story.append(Paragraph(t, H1))
def h2(t): story.append(Paragraph(t, H2))
def p(t): story.append(Paragraph(t, BODY))
def sp(h=6): story.append(Spacer(1, h))
def bullet(t): story.append(Paragraph("&bull;&nbsp; " + t, BULLET))
def rule(): story.append(HRFlowable(width="100%", thickness=0.6,
                                    color=colors.HexColor("#cccccc"),
                                    spaceBefore=8, spaceAfter=8))


def table(data, widths):
    t = Table(data, colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3d7c")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#bbbbbb")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f2f5fb")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)


def cell(t): return Paragraph(t, SMALL)


# ---------------- Content ----------------
h1("CU-Connect — Production Migration Assessment")
p("<b>Topic:</b> What the backend uses, what converts to MongoDB, and whether "
  "the app can go on Vercel. <i>Advisory only — no code changes.</i>")
rule()

h2("1. What your backend actually uses")
p("Your real stack (differs from CLAUDE.md's Postgres+Redis+React description; "
  "this reflects the actual code):")
table([
    [cell("<b>Piece</b>"), cell("<b>Tech</b>"), cell("<b>File(s)</b>")],
    [cell("Web framework"), cell("Express 4"), cell("server.js, routes/*")],
    [cell("Auth"), cell("JWT (jsonwebtoken) + bcryptjs"),
     cell("routes/auth.js, middleware/auth.js")],
    [cell("Database"),
     cell("SQLite via Node built-in node:sqlite (DatabaseSync) — local file cu-connect.db"),
     cell("db/database.js, db/seed.js")],
    [cell("Real-time"), cell("Socket.IO"), cell("lib/realtime.js")],
    [cell("Code IDE execution"),
     cell("child_process.spawn running local python/gcc/java"),
     cell("lib/runner.js, routes/execute.js")],
    [cell("Academics logic"), cell("Bunk calc + SGPA/CGPA (pure JS)"),
     cell("lib/academics.js")],
    [cell("Frontend"), cell("Static HTML, served by Express"),
     cell("Frontend/Landing Page/*.html")],
], [32 * mm, 78 * mm, 45 * mm])

h2("2. What converts to MongoDB")
p("Your 6 SQLite tables become 6 Mongoose collections:")
bullet("users &rarr; <b>User</b>")
bullet("subjects &rarr; <b>Subject</b>")
bullet("attendance &rarr; <b>Attendance</b> { studentId, subjectId, date, status }")
bullet("grades &rarr; <b>Grade</b>")
bullet("leaves + leave_audit &rarr; <b>Leave</b> (audit trail as embedded append-only array)")
bullet("announcements &rarr; <b>Announcement</b>")
sp()
p("<b>The catch:</b> every route uses <b>synchronous</b> SQLite calls "
  "(db.prepare(...).get()/.run()). Mongoose is <b>async</b>, so all 10 backend "
  "files must be rewritten to async/await. Integer auto-increment IDs become "
  "Mongo _id ObjectIds — the JWT payload { id } and all foreign keys "
  "(studentId, subjectId, authorId) change type. Mechanical but touches "
  "everything. You also need <b>MongoDB Atlas</b> (free hosted DB); you can't "
  "ship a local file to production.")

h2("3. Uploading to Vercel — the honest problem")
p("Vercel runs <b>serverless functions</b>: short-lived, stateless, read-only "
  "disk, no persistent process. Three features break on it:")
bullet("<b>SQLite</b> — the .db file is wiped on every cold start and not shared "
       "between instances. Data vanishes. (This is the real reason you need "
       "MongoDB — your instinct is right.)")
bullet("<b>Socket.IO</b> — needs a long-lived connection; serverless functions "
       "die after each request. <b>Live attendance sync won't work.</b>")
bullet("<b>Code IDE (runner.js)</b> — Vercel has no gcc/python/java and a "
       "read-only filesystem. <b>The IDE can't run.</b> It is also unsandboxed "
       "today — a security risk anywhere.")
sp()
p("So \"full project on Vercel\" is <b>not viable as-is</b> without dropping "
  "real-time sync and the IDE.")

h2("4. Suggestions")
p("<b>Recommended split (all free tiers, keeps every feature working):</b>")
bullet("<b>Frontend (static HTML)</b> &rarr; <b>Vercel</b>")
bullet("<b>Backend (Express + Socket.IO)</b> &rarr; <b>Render</b> or <b>Railway</b> "
       "(persistent Node server)")
bullet("<b>Database</b> &rarr; <b>MongoDB Atlas</b> (free M0)")
bullet("<b>Code IDE</b> &rarr; disable in production via a feature flag now; "
       "later wire to hosted <b>Judge0</b> for sandboxed execution. Don't ship "
       "the local spawn runner.")
sp()
p("<b>If you insist on Vercel-only:</b> (a) migrate to Atlas, (b) replace "
  "Socket.IO with polling or a hosted service (Pusher/Ably), and (c) turn off "
  "the IDE. You lose the two real-time/IDE features.")
sp()
p("<b>Production must-dos regardless of host:</b>")
bullet("Move JWT_SECRET to a real env var/secret (hardcoded dev default now).")
bullet("Add CORS config for the split frontend/backend origins.")
bullet("Lock down the unsandboxed code runner before it faces the internet.")
bullet("Add input validation and rate limiting on auth routes.")
rule()
p("<b>Fastest realistic path:</b> MongoDB Atlas migration &rarr; backend on "
  "Render &rarr; frontend on Vercel.")

doc = SimpleDocTemplate(OUT, pagesize=A4, title="CU-Connect Production Assessment",
                        author="CU-Connect", leftMargin=18 * mm, rightMargin=18 * mm,
                        topMargin=16 * mm, bottomMargin=16 * mm)
doc.build(story)
print("Wrote", OUT)
