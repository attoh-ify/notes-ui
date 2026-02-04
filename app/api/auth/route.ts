import { NextResponse } from "next/server"

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const token = await body.token
        console.log("API Auth Route: Setting token cookie for middleware...");

        if (!token) {
            return NextResponse.json({ error: "No token provided" }, { status: 400 })
        }

        const response = NextResponse.json({ success: true })
        response.cookies.set("access_token", token, {
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: true,
            maxAge: 3600
        })

        return response
    } catch (error) {
        console.error("Auth API Error:", error);
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
}