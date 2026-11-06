# metrics_explorer.conf

[metadata]
earliest = <string>
* How far back the metric catalog looks.
* Default: -2d

max_metrics = <int>
* Maximum number of metric names loaded into the tree.
* -1 loads every name.
* Default: 20000

max_dimensions = <int>
* Maximum number of dimensions loaded for a metric.
* -1 loads every dimension.
* Default: -1

hierarchy_source = <string>
* Field used to build the data tree. metric_name is the default.
* Any other value is a dimension name.
* Default: metric_name

hierarchy_separator = <string>
* Character used to split hierarchy_source into tree nodes.
* Allowed: . / \ : |
* Default: .

[features]
data-alerts = <bool>
* Default: 1

data-alerts-scheduled = <bool>
* Default: 1

data-alerts-streaming = <bool>
* Shows streaming alerts only when the instance exposes alerts/metric_alerts.
* Default: 1

global-save-all-to-dashboard = <bool>
* Default: 1

analysis-related-events = <bool>
* Default: 1

analysis-open-in-search = <bool>
* Default: 1

analysis-save-to-dashboard = <bool>
* Default: 1

analysis-save-to-report = <bool>
* Default: 1

analysis-create-alert = <bool>
* Default: 1

state-restore = <bool>
* Default: 1

data-datasets = <bool>
* Default: 1

data-metrics = <bool>
* Default: 1

[defaults]
indexes = <comma-separated list>
* Indexes selected when the explorer opens.
* Removed by the user during the session. This is not an access control.
* Default: empty

metric_name_exclude = <comma-separated wildcard list>
* Metric names hidden from the tree, for example itsi.*.
* Default: empty

[defaults:role_<role>]
* Same keys as [defaults]. The first matching role stanza in this file wins.
