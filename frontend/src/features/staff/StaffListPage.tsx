import { StaffLayout } from "@/features/staff/StaffLayout";
import { DatabaseView } from "@/features/staff/DatabaseView";

export function StaffListPage() {
  return (
    <StaffLayout>
      <DatabaseView />
    </StaffLayout>
  );
}
