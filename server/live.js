'use strict';
// Server-Sent Events hub: pushes new/voided transactions to every open dashboard
// and POS screen in real time, filtered by the viewer's branch permissions.
const clients = new Set();

function subscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  const client = { res, user: req.user };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

function canSee(user, branchId) {
  return user.role === 'admin' || !user.branch_id || branchId == null || user.branch_id === branchId;
}

function publish(event, payload, branchId) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    if (canSee(c.user, branchId)) {
      try { c.res.write(data); } catch { clients.delete(c); }
    }
  }
}

const count = () => clients.size;

module.exports = { subscribe, publish, count };
