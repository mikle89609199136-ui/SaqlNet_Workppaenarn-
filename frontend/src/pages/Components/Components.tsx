import { Button } from "@/design-system/components/Button"
import { Spinner } from "@/design-system/Spinner"
import { User } from "lucide-react"

export const Components = () => {
	return (
		<div className="flex items-center gap-2 flex-wrap p-3">
			<Button size="sm">small</Button>
			<Button>medium</Button>
			<Button size="lg">Крупная</Button>
			<Button variant="secondary">secondary</Button>
			<Button variant="secondary" disabled>secondary</Button>
			<Button variant="ghost">ghost</Button>
			<Button variant="ghost" disabled>ghost</Button>
			<Button variant="danger">danger</Button>
			<Button variant="danger" disabled>danger</Button>
			<Button loading size="sm">with spinner</Button>
			<Button loading>with spinner</Button>
			<Button loading size="lg">with spinner</Button>
			<Button iconOnly size="sm"><User /></Button>
			<Button iconOnly><User /></Button>
			<Button iconOnly size="lg"><User /></Button>
			<Button disabled>disabled</Button>

			<Spinner size="sm"/>
			<Spinner />
			<Spinner size="lg"/>
		</div>
	)
}
