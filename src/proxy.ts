import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isConfigured, publicConfig } from "@/lib/supabase/config";
export async function proxy(request: NextRequest) {
  // Webhooks authenticate at their own raw-body boundary, without a user session.
  if (request.nextUrl.pathname === "/api/webhooks/whatsapp")
    return NextResponse.next();
  if (!isConfigured()) return NextResponse.next();
  let response = NextResponse.next({ request });
  const { url, key } = publicConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  if ((error || !data?.claims) && request.nextUrl.pathname !== "/login") {
    const destination = request.nextUrl.clone();
    destination.pathname = "/login";
    destination.search = "";
    const redirect = NextResponse.redirect(destination);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
