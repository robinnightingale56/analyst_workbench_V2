"""Convenience entry point for the Python API backend."""

import os

import uvicorn


def main():
    uvicorn.run(
        "api_server.main:app",
        app_dir="artifacts/api-server/src",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
    )


if __name__ == "__main__":
    main()
