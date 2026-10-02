import { PageHeader } from '@/components/dashboard/ui'
import BillingView from '@/components/dashboard/BillingView'

export default function BillingPage() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader icon="💳" title="Plan & Usage" subtitle="Your current plan, features, and usage this period." />
      <BillingView />
    </div>
  )
}
