import { Suspense } from "react";
import { Loading } from "@/components/shell/StateViews";
import { TreasuryRoute } from "@/screens/TreasuryRoute";

// useSearchParams needs a Suspense boundary in a static export.
export default function TreasuryPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TreasuryRoute />
    </Suspense>
  );
}
