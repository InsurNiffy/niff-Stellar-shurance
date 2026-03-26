import { Card, CardContent } from '@/components/ui';
import { FileText, Image as ImageIcon, Wallet } from 'lucide-react';

interface ReviewStepProps {
  data: {
    amount: string;
    details: string;
    imageUrls: string[];
  };
  policyId: string;
}

export function ReviewStep({ data, policyId }: ReviewStepProps) {
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
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <Wallet className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium text-muted-foreground">Claim Amount</p>
                <p className="text-lg font-bold">{data.amount} stroops</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-muted-foreground">Policy ID</p>
                <p className="font-medium text-primary">#{policyId}</p>
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
                <p className="text-xs font-medium text-muted-foreground">Narrative</p>
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
                <p className="text-xs font-medium text-muted-foreground">Evidence ({data.imageUrls.length} files)</p>
                <div className="grid grid-cols-1 gap-2">
                  {data.imageUrls.length > 0 ? (
                    data.imageUrls.map((url, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-xs">
                        <span className="truncate flex-1">{url}</span>
                        <a 
                          href={url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          View
                        </a>
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
