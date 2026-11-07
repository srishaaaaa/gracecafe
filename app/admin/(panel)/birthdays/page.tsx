import BirthdaysPage from "../../_ui/BirthdaysPage";

export const metadata = { title: "Birthdays" };

/* Admin and staff both open this: staff can see birthdays and send offers; the shared offer wording is saved for everyone. */
export default function Page() {
  return <BirthdaysPage />;
}
