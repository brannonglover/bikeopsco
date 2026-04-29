import { Plus_Jakarta_Sans } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { AuthProvider } from "@/components/AuthProvider";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata = {
  title: "Bike Ops | Bike Repair Shop Management",
  description: "Bike repair shop management – jobs, customers, payments, and automated emails",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: {
      url: "/favicon-180x180.png",
      sizes: "180x180",
      type: "image/png",
    },
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem("bikeops_theme_preference");var mode=m==="dark"||m==="light"||m==="system"?m:"light";var d=mode==="dark"||(mode==="system"&&matchMedia("(prefers-color-scheme:dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="antialiased bg-mesh text-foreground min-h-screen font-sans flex">
        <ThemeProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
