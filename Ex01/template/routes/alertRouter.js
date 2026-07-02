const express = require("express");
const alertController = require("../controllers/alertController");

const router = express.Router();

router.get("/", alertController.renderAlertPage);

router.get("/api/logs", alertController.getLogs);
router.get("/api/stats", alertController.getStats);

router.post("/api/read-all", alertController.markAllRead);
router.post("/api/read-selected", alertController.markSelectedRead);

module.exports = router;

