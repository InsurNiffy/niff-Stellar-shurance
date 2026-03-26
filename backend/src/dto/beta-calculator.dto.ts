import { IsNumber, Min } from 'class-validator';

export class BetaCalculatorDto {
  @IsNumber()
  @Min(0)
  basePremium!: number;

  @IsNumber()
  @Min(0)
  riskMultiplier!: number;
}
