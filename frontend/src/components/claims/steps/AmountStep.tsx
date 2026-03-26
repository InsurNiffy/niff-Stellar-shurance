import { NumericInput } from '@/components/ui';
import { Label } from '@/components/ui';

interface AmountStepProps {
  amount: string;
  onChange: (amount: string) => void;
  maxCoverage: string;
}

export function AmountStep({ amount, onChange, maxCoverage }: AmountStepProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="amount">Claim Amount (Stroops)</Label>
        <NumericInput
          id="amount"
          value={amount}
          onValueChange={onChange}
          placeholder="Enter claim amount (e.g. 1000000000 for 100 XLM)"
          min="1"
          max={maxCoverage}
        />
        <p className="text-sm text-muted-foreground">
          Maximum coverage remaining: {maxCoverage} stroops
        </p>
      </div>
      <div className="rounded-lg border bg-muted/50 p-4">
        <p className="text-sm">
          <strong>Note:</strong> Claims are subject to review by the DAO and must be within your policy coverage limits.
        </p>
      </div>
    </div>
  );
}
