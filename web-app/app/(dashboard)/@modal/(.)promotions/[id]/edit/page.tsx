import EditPromotionPage from "../../../../promotions/[id]/edit/page"
import { RouteDialog } from "@/components/route-dialog"

export default function EditPromotionModal(props: { params: Promise<{ id: string }> }) {
  return <RouteDialog><EditPromotionPage {...props} /></RouteDialog>
}
