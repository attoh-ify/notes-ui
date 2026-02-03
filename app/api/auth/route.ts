import { NextResponse } from "next/server"

export async function POST(request: Request) {
    console.log(request.json())
    const { token } = await request.json()

    const response = NextResponse.json({ success: true })

    response.cookies.set("access_token", token, {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: true,
        maxAge: 3600
    })

    return response
}