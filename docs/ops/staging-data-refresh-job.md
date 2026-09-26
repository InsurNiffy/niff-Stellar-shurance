# Staging Data Refresh Job

## Overview

Periodic job that (re)populates the staging environment's database with
either anonymized-production data or synthetic data, per the
[environment data policy](./environment-data-policy.md).

## Data Source

Any run of this job must comply with the
[environment data policy](./environment-data-policy.md#data-source-by-environment):
staging may be refreshed with anonymized-production data or synthetic data,
never raw production data. If anonymized-production data is used, it must
meet all of the
[anonymization requirements](./environment-data-policy.md#anonymization-requirements)
before being loaded into staging.
