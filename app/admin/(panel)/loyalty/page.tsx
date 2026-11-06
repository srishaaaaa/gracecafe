import LoyaltyPage from "../../_ui/loyalty/LoyaltyPage";

export const metadata = { title: "Loyalty" };

/* Admin and staff both open this; staff only get the Members tab (see LoyaltyPage). */
export default function Page() {
  return <LoyaltyPage />;
}
