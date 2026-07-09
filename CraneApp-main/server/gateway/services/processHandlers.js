function registerProcessHandlers({ logger, pool, server }) {
    function shutdown(signal) {
        logger.info(`🛑 ${signal} received`);
        server.close(() => {
            pool.end();
            logger.info('✅ Server closed');
            process.exit(0);
        });
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
        logger.error('❌ Uncaught Exception:', error);
        process.exit(1);
    });
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });
}

module.exports = registerProcessHandlers;
