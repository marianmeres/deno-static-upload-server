FROM denoland/deno:latest

WORKDIR /app

COPY deno.json deno.lock ./
COPY src/ src/

RUN deno cache src/cli.ts

EXPOSE 8000

CMD ["deno", "run", "-A", "src/cli.ts"]
