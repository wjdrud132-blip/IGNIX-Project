const express = require("express");
const session = require("express-session");
const conn = require("./config/db");
const managerRouter = require("./routes/manager");
const adminRouter = require("./routes/admin");
const alertRouter = require("./routes/alert");
const trashbinRouter = require("./routes/trashbin");
const alertRecordRouter = require("./routes/alertRouter");
const settingsRouter = require("./routes/settings");
const requireOperator = require("./middlewares/requireOperator");

const app = express(); // express??紐⑤뱺湲곕뒫??app???댁븘以?

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: "fids-session-secret",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use("/manager", managerRouter);
app.use("/admin", adminRouter);
app.use("/alerts", alertRouter);
app.use("/trashbins", trashbinRouter);
app.use("/alert", alertRecordRouter);
app.use("/settings", settingsRouter);

app.get("/join", (req, res) => {
  res.render("join");
});

app.get("/email-check", (req, res) => {
  res.render("email-check");
});

app.get("/password", (req, res) => {
  res.render("password");
});

app.get("/pending", (req, res) => {
  res.render("pending");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/admin/approval", requireOperator, (req, res) => {
  res.render("admin-approval");
});

app.get("/", (req, res) => {
  res.render("main");
});

app.get("/main", (req, res) => {
  res.render("main");
});

app.get("/dashboard", (req, res) => {
  res.render("dashboard");
});

app.get("/trashbins", (req, res) => {
  res.render("trashbins");
});

app.get("/realtime", (req, res) => {
  res.render("realtime");
});

app.set("view engine", "ejs");
app.set("views", __dirname + "/views");

app.listen(3000);






