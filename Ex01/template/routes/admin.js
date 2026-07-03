const express = require("express");
const router = express.Router();

const conn = require("../config/db");
const requireOperator = require("../middlewares/requireOperator");
const { sendManagerApprovalMail, sendManagerRejectMail } = require("../utils/mail");

const GWANGJU_REGIONS = ["동구", "남구", "북구", "광산구", "서구"];

const MSG = {
  pendingListFail: "승인 대기 목록 조회 실패",
  approvedListFail: "승인 완료 목록 조회 실패",
  rejectedListFail: "거절 처리 목록 조회 실패",
  idRequired: "관리자 ID가 필요합니다.",
  lookupFail: "관리자 조회 실패",
  notFound: "관리자를 찾을 수 없습니다.",
  approveFail: "관리자 승인 실패",
  approveMailFail: "관리자 승인은 완료되었지만 이메일 발송은 실패했습니다.",
  approveDone: "관리자 승인이 완료되었고 승인 완료 이메일을 발송했습니다.",
  rejectFail: "관리자 거절 실패",
  rejectMailFail: "관리자 가입 요청은 거절되었지만 이메일 발송은 실패했습니다.",
  rejectDone: "관리자 가입 요청을 거절했고 거절 이메일을 발송했습니다.",
};

function normalizeRegions(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return list
    .map((item) => String(item || "").trim())
    .filter((item) => GWANGJU_REGIONS.includes(item));
}

function ensureAdminColumns(callback) {
  const alters = [
    "ALTER TABLE t_manager ADD COLUMN mgr_org VARCHAR(100) NULL",
    "ALTER TABLE t_manager ADD COLUMN assigned_regions VARCHAR(255) NULL",
    "ALTER TABLE t_manager ADD COLUMN approval_status VARCHAR(20) NULL",
    "ALTER TABLE t_manager ADD COLUMN rejected_at DATETIME NULL",
  ];

  let index = 0;
  function next() {
    if (index >= alters.length) return callback(null);
    conn.query(alters[index], (err) => {
      index += 1;
      if (err && err.code !== "ER_DUP_FIELDNAME") return callback(err);
      next();
    });
  }

  next();
}

function managerSelect(whereClause) {
  return `
    SELECT mgr_id, mgr_email, mgr_name, mgr_phone, mgr_org, assigned_regions, approval_status, is_approved, joined_at, rejected_at
    FROM t_manager
    WHERE ${whereClause}
      AND role = 'manager'
    ORDER BY COALESCE(rejected_at, joined_at) DESC, mgr_id DESC
  `;
}

function getManagerById(mgrId, callback) {
  ensureAdminColumns((columnErr) => {
    if (columnErr) return callback(columnErr);

    const sql = `
      SELECT mgr_id, mgr_email, mgr_name, mgr_phone, mgr_org, assigned_regions, approval_status, is_approved, joined_at, rejected_at
      FROM t_manager
      WHERE mgr_id = ?
        AND role = 'manager'
    `;

    conn.query(sql, [mgrId], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows[0]);
    });
  });
}

router.get("/managers", requireOperator, (req, res) => {
  ensureAdminColumns((columnErr) => {
    if (columnErr) {
      console.error("admin column ensure failed:", columnErr);
      return res.status(500).json({ message: MSG.pendingListFail });
    }

    conn.query(managerSelect("is_approved = '0' AND (approval_status IS NULL OR approval_status = 'pending')"), (err, rows) => {
      if (err) {
        console.error("pending manager list failed:", err);
        return res.status(500).json({ message: MSG.pendingListFail });
      }

      res.json(rows);
    });
  });
});

router.get("/managers/approved", requireOperator, (req, res) => {
  ensureAdminColumns((columnErr) => {
    if (columnErr) {
      console.error("admin column ensure failed:", columnErr);
      return res.status(500).json({ message: MSG.approvedListFail });
    }

    conn.query(managerSelect("is_approved = '1' AND (approval_status IS NULL OR approval_status = 'approved')"), (err, rows) => {
      if (err) {
        console.error("approved manager list failed:", err);
        return res.status(500).json({ message: MSG.approvedListFail });
      }

      res.json(rows);
    });
  });
});

router.get("/managers/rejected", requireOperator, (req, res) => {
  ensureAdminColumns((columnErr) => {
    if (columnErr) {
      console.error("admin column ensure failed:", columnErr);
      return res.status(500).json({ message: MSG.rejectedListFail });
    }

    conn.query(managerSelect("approval_status = 'rejected'"), (err, rows) => {
      if (err) {
        console.error("rejected manager list failed:", err);
        return res.status(500).json({ message: MSG.rejectedListFail });
      }

      res.json(rows);
    });
  });
});

router.post("/managers/approve", requireOperator, (req, res) => {
  const { mgr_id } = req.body;
  const assignedRegions = normalizeRegions(req.body.assigned_regions || req.body.regions);

  if (!mgr_id) {
    return res.status(400).json({ message: MSG.idRequired });
  }

  getManagerById(mgr_id, (findErr, manager) => {
    if (findErr) {
      console.error("manager lookup failed:", findErr);
      return res.status(500).json({ message: MSG.lookupFail });
    }

    if (!manager) {
      return res.status(404).json({ message: MSG.notFound });
    }

    const sql = `
      UPDATE t_manager
      SET is_approved = '1',
          approval_status = 'approved',
          assigned_regions = ?,
          rejected_at = NULL
      WHERE mgr_id = ?
        AND role = 'manager'
    `;

    conn.query(sql, [assignedRegions.join(","), mgr_id], async (err) => {
      if (err) {
        console.error("manager approve failed:", err);
        return res.status(500).json({ message: MSG.approveFail });
      }

      try {
        await sendManagerApprovalMail(manager);
      } catch (mailErr) {
        console.error("approval mail failed:", mailErr);
        return res.json({ message: MSG.approveMailFail });
      }

      res.json({ message: MSG.approveDone });
    });
  });
});

router.post("/managers/reject", requireOperator, (req, res) => {
  const { mgr_id } = req.body;

  if (!mgr_id) {
    return res.status(400).json({ message: MSG.idRequired });
  }

  getManagerById(mgr_id, (findErr, manager) => {
    if (findErr) {
      console.error("manager lookup failed:", findErr);
      return res.status(500).json({ message: MSG.lookupFail });
    }

    if (!manager) {
      return res.status(404).json({ message: MSG.notFound });
    }

    const sql = `
      UPDATE t_manager
      SET is_approved = '0',
          approval_status = 'rejected',
          rejected_at = NOW()
      WHERE mgr_id = ?
        AND role = 'manager'
        AND is_approved = '0'
        AND (approval_status IS NULL OR approval_status = 'pending')
    `;

    conn.query(sql, [mgr_id], async (err) => {
      if (err) {
        console.error("manager reject failed:", err);
        return res.status(500).json({ message: MSG.rejectFail });
      }

      try {
        await sendManagerRejectMail(manager);
      } catch (mailErr) {
        console.error("reject mail failed:", mailErr);
        return res.json({ message: MSG.rejectMailFail });
      }

      res.json({ message: MSG.rejectDone });
    });
  });
});

module.exports = router;