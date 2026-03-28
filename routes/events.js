const express = require('express');
const router = express.Router();

const clients = new Map();
let clientIdCounter = 0;

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const clientId = ++clientIdCounter;
  clients.set(clientId, res);

  res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
  });
});

function broadcast(eventName, data) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, res] of clients) {
    try {
      res.write(message);
    } catch (err) {
      clients.delete(id);
    }
  }
}

function getClientCount() {
  return clients.size;
}

module.exports = router;
module.exports.broadcast = broadcast;
module.exports.getClientCount = getClientCount;
