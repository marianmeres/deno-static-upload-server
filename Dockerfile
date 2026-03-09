FROM denoland/deno:latest

WORKDIR /app

COPY deno.json deno.lock ./
COPY src/ src/

RUN deno cache src/cli.ts

RUN useradd -r -s /bin/false appuser \
    && mkdir -p /data /config \
    && chown appuser:appuser /data /config

USER appuser

EXPOSE 8000

CMD ["deno", "run", "-A", "src/cli.ts"]
