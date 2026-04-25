import os

from app import create_app

app = create_app()

if __name__ == '__main__':
    if os.getenv('APP_ENV', 'production').strip().lower() == 'production':
        raise RuntimeError('Use a production WSGI server such as gunicorn instead of flask.run() in production.')
    app.run(
        host=os.getenv('BACKEND_HOST', '0.0.0.0'),
        port=int(os.getenv('PORT', os.getenv('BACKEND_PORT', '8000'))),
        debug=os.getenv('FLASK_DEBUG', '0') == '1',
    )
