"""Start the adapter on a hard-coded loopback address."""

from __future__ import annotations

import argparse
from pathlib import Path

import uvicorn


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start the Infinite-Canvas loopback adapter")
    parser.add_argument("--port", type=int, default=7862)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    return args


def main() -> None:
    args = parse_args()
    uvicorn.run(
        "app:app",
        app_dir=str(Path(__file__).resolve().parent),
        host="127.0.0.1",
        port=args.port,
        access_log=False,
        server_header=False,
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
