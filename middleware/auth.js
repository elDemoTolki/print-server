function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  return res.redirect('/admin/login');
}

module.exports = { requireAdmin };
