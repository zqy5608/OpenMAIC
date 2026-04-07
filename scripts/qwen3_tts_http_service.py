#!/usr/bin/env python
"""Small HTTP wrapper for qwen_tts' Python API.

Run this inside the conda env where qwen_tts is installed:

    python scripts/qwen3_tts_http_service.py --model Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice

OpenMAIC can then call http://127.0.0.1:8000 through the qwen3-local-tts provider.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import soundfile as sf


class Qwen3TTSService:
    def __init__(
        self,
        model_id: str,
        default_language: str,
        default_speaker: str,
        load_kwargs: dict[str, Any],
    ) -> None:
        from qwen_tts import Qwen3TTSModel

        print(f"Loading Qwen3 TTS model: {model_id}", flush=True)
        self.model_id = model_id
        self.default_language = default_language
        self.default_speaker = default_speaker
        self.model = Qwen3TTSModel.from_pretrained(model_id, **load_kwargs)
        self.lock = threading.Lock()
        print("Qwen3 TTS model is ready.", flush=True)

    def synthesize(self, request: dict[str, Any]) -> bytes:
        text = pick_string(request, "text", "input")
        if not text:
            raise ValueError("Request body must include a non-empty text or input field.")

        language = pick_string(request, "language") or self.default_language
        speaker = pick_string(request, "speaker", "voice") or self.default_speaker
        instruct = pick_string(request, "instruct", "instruction") or None

        with self.lock:
            wavs, sample_rate = self.model.generate_custom_voice(
                text=text,
                language=language,
                speaker=speaker,
                instruct=instruct,
            )

        if not wavs:
            raise RuntimeError("Qwen3 TTS returned no waveform.")

        buffer = io.BytesIO()
        sf.write(buffer, wavs[0], sample_rate, format="WAV")
        return buffer.getvalue()

    def health(self) -> dict[str, Any]:
        languages = None
        speakers = None

        get_supported_languages = getattr(self.model, "get_supported_languages", None)
        if callable(get_supported_languages):
            languages = get_supported_languages()

        get_supported_speakers = getattr(self.model, "get_supported_speakers", None)
        if callable(get_supported_speakers):
            speakers = get_supported_speakers()

        return {
            "ok": True,
            "model": self.model_id,
            "defaultLanguage": self.default_language,
            "defaultSpeaker": self.default_speaker,
            "languages": languages,
            "speakers": speakers,
        }


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "OpenMAICQwen3TTS/1.0"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path in ("/health", "/healthz"):
            self.write_json(HTTPStatus.OK, self.service.health())
            return

        self.write_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path not in ("/", "/tts", "/v1/audio/speech"):
            self.write_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            request = self.read_json_body()
            audio = self.service.synthesize(request)
        except Exception as error:  # noqa: BLE001 - return the concrete service error to caller.
            self.write_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        self.send_response(HTTPStatus.OK)
        self.send_cors_headers()
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    @property
    def service(self) -> Qwen3TTSService:
        return self.server.service  # type: ignore[attr-defined]

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)
        if not raw_body:
            raise ValueError("Request body is empty.")

        parsed = json.loads(raw_body.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("Request body must be a JSON object.")
        return parsed

    def write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


class Qwen3TTSServer(ThreadingHTTPServer):
    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[BaseHTTPRequestHandler],
        service: Qwen3TTSService,
    ) -> None:
        super().__init__(server_address, handler_class)
        self.service = service


def pick_string(data: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def dtype_from_string(dtype: str) -> Any:
    import torch

    normalized = dtype.lower()
    if normalized in ("bfloat16", "bf16"):
        return torch.bfloat16
    if normalized in ("float16", "fp16"):
        return torch.float16
    if normalized in ("float32", "fp32"):
        return torch.float32
    raise ValueError(f"Unsupported dtype: {dtype}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a minimal Qwen3 TTS HTTP service.")
    parser.add_argument(
        "--model",
        default="Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        help="Hugging Face repo id or local checkpoint path.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind host.")
    parser.add_argument("--port", type=int, default=8000, help="HTTP bind port.")
    parser.add_argument("--language", default="chinese", help="Default synthesis language.")
    parser.add_argument("--speaker", default="vivian", help="Default CustomVoice speaker.")
    parser.add_argument("--device", default=None, help="Optional device_map, such as cuda:0 or cpu.")
    parser.add_argument(
        "--dtype",
        default=None,
        choices=["bfloat16", "bf16", "float16", "fp16", "float32", "fp32"],
        help="Optional torch dtype for model loading.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    load_kwargs: dict[str, Any] = {}
    if args.device:
        load_kwargs["device_map"] = args.device
    if args.dtype:
        load_kwargs["dtype"] = dtype_from_string(args.dtype)

    try:
        service = Qwen3TTSService(
            model_id=args.model,
            default_language=args.language,
            default_speaker=args.speaker,
            load_kwargs=load_kwargs,
        )
        server = Qwen3TTSServer((args.host, args.port), RequestHandler, service)
        print(f"Qwen3 TTS HTTP service listening on http://{args.host}:{args.port}", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Qwen3 TTS HTTP service.", flush=True)
        return 0
    except Exception as error:  # noqa: BLE001 - command-line entrypoint should print any startup error.
        print(f"Qwen3 TTS HTTP service failed: {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
