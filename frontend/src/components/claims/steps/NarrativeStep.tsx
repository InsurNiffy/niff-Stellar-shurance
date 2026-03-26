import { Label } from '@/components/ui';

interface NarrativeStepProps {
  details: string;
  onChange: (details: string) => void;
}

export function NarrativeStep({ details, onChange }: NarrativeStepProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="details">Claim Narrative</Label>
        <textarea
          id="details"
          value={details}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe what happened and why you are filing this claim..."
          className="min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          maxLength={1000}
        />
        <p className="text-right text-xs text-muted-foreground">
          {details.length}/1000 characters
        </p>
      </div>
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/30 dark:bg-yellow-900/20">
        <p className="text-sm text-yellow-800 dark:text-yellow-200">
          <strong>Privacy Warning:</strong> Do not include sensitive personal information (SSN, medical records, etc.) directly in the narrative. Focus on the event details.
        </p>
      </div>
    </div>
  );
}
