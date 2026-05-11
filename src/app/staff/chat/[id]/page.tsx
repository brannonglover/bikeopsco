import { redirect } from "next/navigation";

/**
 * Web fallback for the mobile app deep link.
 * When the BikeOps app is installed, iOS/Android intercept this URL and open
 * the app directly. When the app is not installed, the browser lands here and
 * we redirect to the staff web chat page.
 */
export default async function StaffChatDeepLinkPage() {
  redirect("/chat");
}
