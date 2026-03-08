import { serveDir } from "jsr:@std/http/file-server";
import { join } from "jsr:@std/path";

export interface StaticServerOptions {
  port?: number;
  staticDir?: string;
  uploadTokens?: string[]; // multiple tokens for zero-downtime rotation
  uploadPath?: string;     // e.g. "/upload"
  staticRoutePath?: string // e.g. "/static"
}

const DEFAULT_OPTIONS: Required<StaticServerOptions> = {
  port: 8000,
  staticDir: "./static",
  uploadTokens: [],
  uploadPath: "/upload",
  staticRoutePath: "/static",
};

function isAuthorized(req: Request, tokens: string[]): boolean {
  if (tokens.length === 0) return true; // auth disabled
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return token !== null && tokens.includes(token);
}

export function createServer(opts: StaticServerOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...opts };

  // Normalise: ensure paths end without slash
  const staticRoute = options.staticRoutePath.replace(/\/$/, "");
  const uploadRoute = options.uploadPath.replace(/\/$/, "");

  async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // POST /upload/:projectId
    if (req.method === "POST" && url.pathname.startsWith(uploadRoute + "/")) {
      if (!isAuthorized(req, options.uploadTokens)) {
        return new Response("Unauthorized", { status: 401 });
      }

      const projectId = url.pathname.slice(uploadRoute.length + 1).split("/")[0];
      if (!projectId || !/^[a-zA-Z0-9\-_]+$/.test(projectId)) {
        return new Response("Invalid or missing project ID", { status: 400 });
      }

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        return new Response("Invalid form data", { status: 400 });
      }

      const uploaded: string[] = [];

      for (const [_field, value] of formData.entries()) {
        if (!(value instanceof File)) continue;

        const filename = value.name;
        if (!filename) continue;

        // Sanitize each path segment individually, preserving subdir structure
        const safePath = filename
          .split("/")
          .map(segment => segment.replace(/[^a-zA-Z0-9.\-_]/g, "_"))
          .filter(segment => segment.length > 0 && segment !== ".")
          .join("/");

        const destPath = join(options.staticDir, projectId, safePath);
        const destDir = destPath.substring(0, destPath.lastIndexOf("/"));

        await Deno.mkdir(destDir, { recursive: true });
        await Deno.writeFile(destPath, value.stream());

        uploaded.push(`${staticRoute}/${projectId}/${safePath}`);
      }

      if (uploaded.length === 0) {
        return new Response("No files received", { status: 400 });
      }

      return Response.json({ uploaded });
    }

    // GET /static/* — served by serveDir
    if (req.method === "GET" && url.pathname.startsWith(staticRoute)) {
      return serveDir(req, {
        fsRoot: options.staticDir,
        urlRoot: staticRoute.slice(1), // serveDir expects without leading slash
        enableCors: true,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  return {
    start() {
      console.log(`Listening on :${options.port}`);
      console.log(`  Upload : POST ${uploadRoute}/:projectId`);
      console.log(`  Static : GET  ${staticRoute}/:projectId/*`);
      console.log(`  Auth   : ${options.uploadTokens.length > 0 ? "enabled" : "disabled"}`);
      Deno.serve({ port: options.port }, handler);
    },
  };
}
