import { NumericInput } from '@/components/ui';
import { Label } from '@/components/ui';
import { formatTokenAmount } from '@/lib/formatTokenAmount';

interface AmountStepProps {
  amount: string;
  onChange: (amount: string) => void;
  maxCoverage: string;
  decimals?: number;
  currency?: string;
  locale?: string;
}

export function AmountStep({ amount, onChange, maxCoverage, decimals = 7, currency = 'XLM', locale = 'en-US' }: AmountStepProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="amount">Claim Amount ({currency})</Label>
        <NumericInput
          id="amount"
          value={amount}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter claim amount (e.g. 10000000 for 1 ${currency})`}
          min="1"
          max={maxCoverage}
        />
        <p className="text-sm text-muted-foreground">
          Maximum coverage remaining: {formatTokenAmount(maxCoverage || '0', decimals, locale)} {currency}
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
