function createErrorHandler({ logger }) {
    return (err, req, res, next) => {
        logger.error('❌ Error:', err);

        if (req.path.startsWith('/api/')) {
            return res.status(err.status || 500).json({
                error: err.message || 'Internal server error',
            });
        }

        res.status(err.status || 500)
           .set({
               'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
               'Pragma': 'no-cache',
               'Expires': '0',
               'Surrogate-Control': 'no-store'
           })
           .sendFile(
            'public/server-down.html',
            { root: process.cwd() }
        );
    };
}

function notFoundHandler(req, res) {
    res.status(404).json({ error: 'Not found', path: req.path });
}

module.exports = {
    createErrorHandler,
    notFoundHandler,
};
