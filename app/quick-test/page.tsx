// app/quick-test/page.tsx
import { Suspense } from "react";
import QuickTestPro from "@/components/QuickTestPro";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Cargando…</div>}>
      <QuickTestPro />
    </Suspense>
  );
}
