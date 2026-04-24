# Research Notes: Real-Data Trading Venture Roadmap

## FINRA AI supervision and model governance

FINRA notes that firms adopting AI-based applications should consider **model risk management, data governance, customer privacy, supervisory control systems, cybersecurity, outsourcing/vendor management, and books and records**. It also emphasizes ongoing testing, stressed-scenario validation, inventorying models, benchmarking model performance, and explainability before deployment.

## SEC market access controls

The SEC's Rule 15c3-5 FAQ explains that broker-dealers with market access must maintain **risk management controls and supervisory procedures** designed to limit financial exposure and ensure regulatory compliance. The required controls include pre-set credit or capital thresholds, prevention of erroneous orders via price/size checks, access restriction to authorized persons, and post-trade reporting to surveillance staff. The SEC also states these controls apply to **all orders**, including automatically generated orders, and must be reviewed regularly for effectiveness.

## Implication for Laurenzo

A credible real-data trading product cannot jump from signal generation to automated production trading. It needs staged validation, explainable models, pre-trade risk checks, hard capital limits, authorization controls, logging, and an operating model that assumes models can fail under stress.
