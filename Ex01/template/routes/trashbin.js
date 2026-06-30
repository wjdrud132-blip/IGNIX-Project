const express = require("express");
const router = express.Router();

const conn = require("../config/db");
const { judgeDanger, defaultThresholds } = require("../utils/aiJudge");
const { filterRowsByRegion, canViewLocation } = require("../utils/regionScope");

router.get("/list", (req, res) => {
  const sql = `
    SELECT
      b.bin_id,
      b.bin_loc,
      b.installed_at,
      b.mgr_id,
      b.network_status,
      b.created_at,
      m.mgr_name,
      m.mgr_phone,
      a.alert_id,
      CASE
        WHEN b.bin_id IN (1, 2, 3, 4) THEN 'danger'
        WHEN b.bin_id IN (5, 6, 7) THEN 'warning'
        ELSE 'normal'
      END AS alert_type,
      a.alert_msg,
      a.alerted_at,
      a.is_received
    FROM t_trashbin b
    LEFT JOIN t_manager m
      ON b.mgr_id = m.mgr_id
    LEFT JOIN (
      SELECT a1.*
      FROM t_alert a1
      INNER JOIN (
        SELECT bin_id, MAX(alerted_at) AS latest_alerted_at
        FROM t_alert
        GROUP BY bin_id
      ) latest
        ON a1.bin_id = latest.bin_id
       AND a1.alerted_at = latest.latest_alerted_at
    ) a
      ON b.bin_id = a.bin_id
    WHERE IFNULL(b.network_status, 1) <> 9
    ORDER BY
      CASE
        WHEN b.bin_id IN (1, 2, 3, 4) THEN 1
        WHEN b.bin_id IN (5, 6, 7) THEN 2
        ELSE 3
      END,
      b.bin_id ASC
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("쓰레기통 목록 조회 실패:", err);
      return res.status(500).json({ message: "쓰레기통 목록 조회 실패" });
    }

    rows = filterRowsByRegion(req, rows, "bin_loc");

    const thresholdSql = "SELECT danger_temp, warning_temp, danger_smoke, warning_smoke FROM t_fire_threshold WHERE id = 1";
    const aiSql = "SELECT setting_value FROM t_system_setting WHERE setting_key = 'aiJudge'";

    conn.query(thresholdSql, (thresholdErr, thresholdRows) => {
      const thresholdRow = thresholdRows && thresholdRows[0];
      const thresholds = thresholdErr || !thresholdRow ? defaultThresholds : {
        dangerTemp: Number(thresholdRow.danger_temp),
        warningTemp: Number(thresholdRow.warning_temp),
        dangerSmoke: Number(thresholdRow.danger_smoke),
        warningSmoke: Number(thresholdRow.warning_smoke),
      };

      conn.query(aiSql, (aiErr, aiRows) => {
        const aiEnabled = !aiErr && aiRows && aiRows[0] ? aiRows[0].setting_value !== "N" : true;
        const judgedRows = rows.map((row) => {
          const ruleStatus = row.alert_type;
          const ai = judgeDanger(row, thresholds, aiEnabled);
          return {
            ...row,
            rule_status: ruleStatus,
            alert_type: ai.status,
            ai_enabled: aiEnabled ? "Y" : "N",
            ai_status: ai.status,
            ai_reason: ai.reason.join(" "),
            ai_confidence: ai.confidence,
            temp_value: ai.sensor.temp,
            smoke_value: ai.sensor.smoke,
            flame_value: ai.sensor.flame,
          };
        }).sort((a, b) => {
          const rank = (type) => type === "danger" ? 1 : type === "warning" ? 2 : 3;
          return rank(a.alert_type) - rank(b.alert_type) || Number(a.bin_id) - Number(b.bin_id);
        });
        res.json(judgedRows);
      });
    });
  });
});

router.get("/trash/list", (req, res) => {
  const sql = `
    SELECT
      b.bin_id,
      b.bin_loc,
      b.installed_at,
      b.mgr_id,
      b.network_status,
      b.created_at,
      m.mgr_name
    FROM t_trashbin b
    LEFT JOIN t_manager m
      ON b.mgr_id = m.mgr_id
    WHERE b.network_status = 9
    ORDER BY b.bin_id ASC
  `;

  conn.query(sql, (err, rows) => {
    if (err) {
      console.error("휴지통 목록 조회 실패:", err);
      return res.status(500).json({ message: "휴지통 목록 조회 실패" });
    }

    res.json(filterRowsByRegion(req, rows, "bin_loc"));
  });
});

router.patch("/trash/:bin_id/restore", (req, res) => {
  const { bin_id } = req.params;

  conn.query(
    "UPDATE t_trashbin SET network_status = 1 WHERE bin_id = ? AND network_status = 9",
    [bin_id],
    (err, result) => {
      if (err) {
        console.error("\uD734\uC9C0\uD1B5 \uBCF5\uAD6C \uC2E4\uD328:", err);
        return res.status(500).json({ message: "\uBCF5\uAD6C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4." });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "\uBCF5\uAD6C\uD560 \uC4F0\uB808\uAE30\uD1B5\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
      }

      res.json({ message: "\uC4F0\uB808\uAE30\uD1B5\uC774 \uBCF5\uAD6C\uB418\uC5C8\uC2B5\uB2C8\uB2E4." });
    }
  );
});

router.delete("/trash/:bin_id", (req, res) => {
  const { bin_id } = req.params;

  conn.query("DELETE FROM t_alert WHERE bin_id = ?", [bin_id], (alertErr) => {
    if (alertErr) {
      console.error("휴지통 알림 완전 삭제 실패:", alertErr);
      return res.status(500).json({ message: "알림 데이터 삭제 실패" });
    }

    conn.query("DELETE FROM t_trashbin WHERE bin_id = ? AND network_status = 9", [bin_id], (err, result) => {
      if (err) {
        console.error("휴지통 쓰레기통 완전 삭제 실패:", err);
        return res.status(500).json({ message: "완전 삭제 실패" });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "휴지통에서 삭제할 쓰레기통을 찾을 수 없습니다." });
      }

      res.json({ message: "DB에서 완전히 삭제되었습니다." });
    });
  });
});

router.post("/", (req, res) => {
  const { bin_loc, installed_at, network_status } = req.body;
  const mgr_id = req.body.mgr_id || req.session?.user?.user_id || req.session?.user?.mgr_id;

  if (!bin_loc || !installed_at || !mgr_id) {
    return res.status(400).json({ message: "위치와 설치일을 입력하고 로그인 상태를 확인해주세요." });
  }

  const sql = `
    INSERT INTO t_trashbin
      (bin_loc, installed_at, mgr_id, network_status)
    VALUES
      (?, ?, ?, ?)
  `;

  conn.query(sql, [bin_loc, installed_at, mgr_id, network_status || 1], (err, result) => {
    if (err) {
      console.error("쓰레기통 등록 실패:", err);
      return res.status(500).json({ message: "쓰레기통 등록 실패" });
    }

    res.json({
      message: "쓰레기통이 등록되었습니다.",
      bin_id: result.insertId,
    });
  });
});

router.delete("/:bin_id", (req, res) => {
  const { bin_id } = req.params;

  const sql = `
    UPDATE t_trashbin
    SET network_status = 9
    WHERE bin_id = ?
  `;

  conn.query(sql, [bin_id], (err, result) => {
    if (err) {
      console.error("쓰레기통 휴지통 이동 실패:", err);
      return res.status(500).json({ message: "쓰레기통 휴지통 이동 실패" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "이동할 쓰레기통을 찾을 수 없습니다." });
    }

    res.json({ message: "쓰레기통이 휴지통으로 이동되었습니다." });
  });
});

module.exports = router;







