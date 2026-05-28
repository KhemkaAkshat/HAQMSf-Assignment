class AppError extends Error {
  constructor(statusCode, message, code = 'APP_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const notFound = (req, res, next) => {
  next(new AppError(404, 'Route not found', 'NOT_FOUND'));
};

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || statusCode < 500;

  console.error('[ERROR]', {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code: err.code || 'INTERNAL_ERROR',
    message: err.message,
  });

  res.status(statusCode).json({
    success: false,
    error: isOperational ? err.message : 'Internal server error',
    code: err.code || (isOperational ? 'REQUEST_FAILED' : 'INTERNAL_ERROR'),
  });
};

module.exports = {
  AppError,
  asyncHandler,
  notFound,
  errorHandler,
};
