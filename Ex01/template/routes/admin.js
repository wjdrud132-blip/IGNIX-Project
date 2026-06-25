const express = require("express");
const router = express.Router();

const conn = require("../config/db");
const requireOperator = require("../middlewares/requireOperator");
const { sendManagerApprovalMail, sendManagerRejectMail } = require("../utils/mail");

const MSG = {
  pendingListFail: "\uC2B9\uC778 \uB300\uAE30 \uBAA9\uB85D \uC870\uD68C \uC2E4\uD328",
  approvedListFail: "\uC2B9\uC778 \uC644\uB8CC \uBAA9\uB85D \uC870\uD68C \uC2E4\uD328",
  idRequired: "\uAD00\uB9AC\uC790 ID\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.",
  lookupFail: "\uAD00\uB9AC\uC790 \uC870\uD68C \uC2E4\uD328",
  notFound: "\uAD00\uB9AC\uC790\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
  approveFail: "\uAD00\uB9AC\uC790 \uC2B9\uC778 \uC2E4\uD328",
  approveMailFail: "\uAD00\uB9AC\uC790 \uC2B9\uC778\uC740 \uC644\uB8CC\uB418\uC5C8\uC9C0\uB9CC \uC774\uBA54\uC77C \uBC1C\uC1A1\uC740 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  approveDone: "\uAD00\uB9AC\uC790 \uC2B9\uC778\uC774 \uC644\uB8CC\uB418\uC5C8\uACE0 \uC2B9\uC778 \uC644\uB8CC \uC774\uBA54\uC77C\uC744 \uBC1C\uC1A1\uD588\uC2B5\uB2C8\uB2E4.",
  rejectFail: "\uAD00\uB9AC\uC790 \uAC70\uC808 \uC2E4\uD328",
  rejectMailFail: "\uAD00\uB9AC\uC790 \uAC00\uC785 \uC694\uCCAD\uC740 \uAC70\uC808\uB418\uC5C8\uC9C0\uB9CC \uC774\uBA54\uC77C \uBC1C\uC1A1\uC740 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  rejectDone: "\uAD00\uB9AC\uC790 \uAC00\uC785 \uC694\uCCAD\uC744 \uAC70\uC808\uD588\uACE0 \uAC70\uC808 \uC774\uBA54\uC77C\uC744 \uBC1C\uC1A1\uD588\uC2B5\uB2C8\uB2E4.",
};

function getManagerById(mgrId, callback) {
  const sql = `
    SELECT mgr_id, mgr_email, mgr_name, mgr_phone, is_approved, joined_at
    FROM t_manager
    WHERE mgr_id = ?
      AND role = 'manager'
  `;

  conn.query(sql, [mgrId], (err, rows) => {
    if (err) return callback(err);
    callback(null, rows[0]);
  });
}

router.get("/managers", requireOperator, (req, res) => {
  const sql = `
    SELECT mgr_id, mgr_email, mgr_name, mgr_phone, is_approved, joined_at
    FROM t_manager
    WHERE is_approved = 0
      AND role = 'manager'
    ORDER BY joined_at DESC
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("pending manager list failed:", err);
      return res.status(500).json({ message: MSG.pendingListFail });
    }

    res.json(rows);
  });
});

router.get("/managers/approved", requireOperator, (req, res) => {
  const sql = `
    SELECT mgr_id, mgr_email, mgr_name, mgr_phone, is_approved, joined_at
    FROM t_manager
    WHERE is_approved = 1
      AND role = 'manager'
    ORDER BY joined_at DESC
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("approved manager list failed:", err);
      return res.status(500).json({ message: MSG.approvedListFail });
    }

    res.json(rows);
  });
});

router.post("/managers/approve", requireOperator, (req, res) => {
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
      SET is_approved = 1
      WHERE mgr_id = ?
        AND role = 'manager'
    `;

    conn.query(sql, [mgr_id], async (err) => {
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
      DELETE FROM t_manager
      WHERE mgr_id = ?
        AND role = 'manager'
        AND is_approved = 0
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
