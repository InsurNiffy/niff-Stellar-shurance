import { FileText, Image as ImageIcon, Wallet } from 'lucide-react';

import { Card, CardContent } from '@/components/ui';

interface ReviewStepProps {
  data: {
    amount: string;
    details: string;
    evidence: { url: string; contentSha256Hex: string }[];
  };
  policyId: string;
  onEdit?: (step: number) => void;
}

export function ReviewStep({ data, policyId, onEdit }: ReviewStepProps) {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Review Claim Details</h3>
        <p className="text-sm text-muted-foreground">
          Please confirm the information below before signing the transaction with your wallet.
        </p>
      </div>

      <div className="grid gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <Wallet className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Claim Amount</p>
                  {onEdit && (
                    <button 
                      onClick={() => onEdit(0)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Edit
                    </button>
                  )}
                </div>
                <p className="text-lg font-bold">{data.amount} stroops</p>
                <p className="text-xs text-muted-foreground">Policy ID: #{policyId}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Narrative</p>
                  {onEdit && (
                    <button 
                      onClick={() => onEdit(1)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Edit
                    </button>
                  )}
                </div>
                <p className="text-sm leading-relaxed">{data.details || 'No details provided.'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <ImageIcon className="h-5 w-5" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Evidence ({data.evidence.length} files)</p>
                  {onEdit && (
                    <button 
                      onClick={() => onEdit(2)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Edit
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {data.evidence.length > 0 ? (
                    data.evidence.map((item, i) => (
                      <div key={i} className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate max-w-[200px]" title={item.url}>
                            {item.url.split('/').pop() || 'file'}
                          </span>
                          <a 
                            href={item.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            View
                          </a>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="shrink-0 font-mono">Hash:</span>
                          <span className="truncate font-mono" title={item.contentSha256Hex}>
                            {item.contentSha256Hex.substring(0, 16)}...{item.contentSha256Hex.substring(item.contentSha256Hex.length - 8)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No evidence uploaded.</p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 text-center">
        <p className="text-sm font-medium">
          Ready to submit? You will be prompted to sign the transaction via your Stellar wallet.
        </p>
      </div>
    </div>
  );
}
