const express = require("express");
const conn = require("../config/db");
const requireOperator = require("../middlewares/requireOperator");

const router = express.Router();

const defaultThresholds = Object.freeze({
  dangerTemp: 80,
  warningTemp: 55,
  dangerSmoke: 300,
  warningSmoke: 100,
});

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }
  return res.redirect("/login");
}

async function ensureManagerColumns() {
  try {
    await query("ALTER TABLE t_manager ADD COLUMN mgr_org VARCHAR(100) NULL");
  } catch (err) {
    if (err.code !== "ER_DUP_FIELDNAME") throw err;
  }
}

function toClient(row) {
  return {
    dangerTemp: Number(row.danger_temp),
    warningTemp: Number(row.warning_temp),
    dangerSmoke: Number(row.danger_smoke),
    warningSmoke: Number(row.warning_smoke),
  };
}

async function ensureThresholdTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS t_fire_threshold (
      id INT NOT NULL PRIMARY KEY,
      danger_temp DECIMAL(5,1) NOT NULL,
      warning_temp DECIMAL(5,1) NOT NULL,
      danger_smoke INT NOT NULL,
      warning_smoke INT NOT NULL,
      updated_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await query(
    `INSERT IGNORE INTO t_fire_threshold
      (id, danger_temp, warning_temp, danger_smoke, warning_smoke)
     VALUES (1, ?, ?, ?, ?)`,
    [defaultThresholds.dangerTemp, defaultThresholds.warningTemp, defaultThresholds.dangerSmoke, defaultThresholds.warningSmoke]
  );
}

async function getThresholds() {
  await ensureThresholdTable();
  const rows = await query("SELECT * FROM t_fire_threshold WHERE id = 1");
  if (!rows.length) return defaultThresholds;
  return toClient(rows[0]);
}

router.get("/", requireLogin, (req, res) => {
  res.render("settings", { user: req.session.user || null });
});

router.get("/api/thresholds", requireLogin, async (req, res) => {
  try {
    const thresholds = await getThresholds();
    res.json({ success: true, thresholds });
  } catch (err) {
    console.error("임계값 조회 실패:", err);
    res.status(500).json({ success: false, message: "임계값을 불러오지 못했습니다." });
  }
});

router.post("/api/thresholds", requireOperator, async (req, res) => {
  const next = {
    dangerTemp: Number(req.body.dangerTemp),
    warningTemp: Number(req.body.warningTemp),
    dangerSmoke: Number(req.body.dangerSmoke),
    warningSmoke: Number(req.body.warningSmoke),
  };

  if (Object.values(next).some((value) => !Number.isFinite(value))) {
    return res.status(400).json({ success: false, message: "숫자 값을 입력해주세요." });
  }

  if (next.warningTemp >= next.dangerTemp) {
    return res.status(400).json({ success: false, message: "주의 온도는 위험 온도보다 낮아야 합니다." });
  }

  if (next.warningSmoke >= next.dangerSmoke) {
    return res.status(400).json({ success: false, message: "주의 연기감지값은 위험 연기감지값보다 낮아야 합니다." });
  }

  try {
    await ensureThresholdTable();
    await query(
      `UPDATE t_fire_threshold
       SET danger_temp = ?, warning_temp = ?, danger_smoke = ?, warning_smoke = ?, updated_by = ?
       WHERE id = 1`,
      [next.dangerTemp, next.warningTemp, next.dangerSmoke, next.warningSmoke, req.session.user.user_id]
    );

    const thresholds = await getThresholds();
    res.json({ success: true, thresholds, message: "임계값이 변경되었습니다." });
  } catch (err) {
    console.error("임계값 저장 실패:", err);
    res.status(500).json({ success: false, message: "임계값 저장에 실패했습니다." });
  }
});

router.post("/api/thresholds/reset", requireOperator, async (req, res) => {
  try {
    await ensureThresholdTable();
    await query(
      `UPDATE t_fire_threshold
       SET danger_temp = ?, warning_temp = ?, danger_smoke = ?, warning_smoke = ?, updated_by = ?
       WHERE id = 1`,
      [defaultThresholds.dangerTemp, defaultThresholds.warningTemp, defaultThresholds.dangerSmoke, defaultThresholds.warningSmoke, req.session.user.user_id]
    );

    const thresholds = await getThresholds();
    res.json({ success: true, thresholds, message: "기본 임계값으로 초기화되었습니다." });
  } catch (err) {
    console.error("임계값 초기화 실패:", err);
    res.status(500).json({ success: false, message: "임계값 초기화에 실패했습니다." });
  }
});

router.get("/api/profile", requireLogin, async (req, res) => {
  try {
    await ensureManagerColumns();
    const rows = await query(
      `SELECT mgr_id, mgr_email, mgr_name, mgr_phone, mgr_org, is_approved, role
       FROM t_manager
       WHERE mgr_id = ?`,
      [req.session.user.user_id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "계정 정보를 찾을 수 없습니다." });
    }

    res.json({ success: true, profile: rows[0] });
  } catch (err) {
    console.error("계정 정보 조회 실패:", err);
    res.status(500).json({ success: false, message: "계정 정보를 불러오지 못했습니다." });
  }
});

router.post("/api/profile", requireLogin, async (req, res) => {
  const user = req.session.user;
  const name = String(req.body.mgr_name || "").trim();
  const org = String(req.body.mgr_org || "").trim();
  const email = String(req.body.mgr_email || "").trim();
  const phone = String(req.body.mgr_phone || "").trim();

  if (!name || !email) {
    return res.status(400).json({ success: false, message: "이름과 이메일은 필수입니다." });
  }

  try {
    await ensureManagerColumns();
    const rows = await query("SELECT mgr_email, role FROM t_manager WHERE mgr_id = ?", [user.user_id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "계정 정보를 찾을 수 없습니다." });
    }

    const currentEmail = rows[0].mgr_email;
    const emailChanged = currentEmail !== email;
    const shouldRequireApproval = emailChanged && rows[0].role !== "operator";

    await query(
      `UPDATE t_manager
       SET mgr_name = ?, mgr_org = ?, mgr_email = ?, mgr_phone = ?, is_approved = CASE WHEN ? THEN 0 ELSE is_approved END
       WHERE mgr_id = ?`,
      [name, org, email, phone, shouldRequireApproval, user.user_id]
    );

    req.session.user.email = email;
    if (shouldRequireApproval) {
      req.session.user.approval_status = 0;
    }

    res.json({
      success: true,
      requiresApproval: shouldRequireApproval,
      message: shouldRequireApproval
        ? "이메일이 변경되어 관리자 승인이 다시 필요합니다."
        : "계정 정보가 저장되었습니다.",
      profile: { mgr_name: name, mgr_org: org, mgr_email: email, mgr_phone: phone },
    });
  } catch (err) {
    console.error("계정 정보 저장 실패:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ success: false, message: "이미 사용 중인 이메일입니다." });
    }
    res.status(500).json({ success: false, message: "계정 정보 저장에 실패했습니다." });
  }
});

module.exports = router;