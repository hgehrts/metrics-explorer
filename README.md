# Metric Explorer NG

<p>
  <img src="app/static/appIcon_2x.png" alt="Metric Explorer NG" width="144">
</p>

## Splunkbase listing

**Title**

```
Metric Explorer NG
```

**Summary** (short description)

```
Browse Splunk metric indexes and chart them without writing SPL. Save charts as dashboards, alerts, or reports.
```

**Description**

```
Splunk removed the Analytics Workspace in Splunk Enterprise 10.6 and Splunk Cloud Platform 10.6 without a replacement. Metric Explorer NG brings that workflow back as a Splunk app.

- Browse metric indexes, metrics, dimensions, events, datasets, base searches, and alerts in one column.
- Click a metric to chart it. Add more metrics, formulas, and series, each with its own aggregation, split, filter, time shift, and right axis.
- Trellis splits a chart into small multiples, one per value of a dimension, with paging and shared scales on export.
- One time range, zoom, and time span for all charts, plus a global split-by.
- Save charts as Classic or Dashboard Studio dashboards, with optional time, split-by, and span inputs. You can also save them as reports, scheduled or streaming alerts, or base searches.
- Export charts as PNG or CSV. Named workspaces save and restore your whole session.

You do not write SPL by hand. The app generates it, and "Open in Search" shows it for any chart.
```

**Keywords**

```
splunk metrics, mstats, metric indexes, analytics workspace, metrics explorer, dashboard, charts, time series
```

**Release notes for 2.1.3**

```
2.1.3: Enable check_for_updates in app.conf for Splunkbase compatibility.
2.1.2: Documentation and README update. Trellis is described in the README and the Splunkbase text.
2.1.1: The split-by filter now applies to every appended series in exported dashboards.
2.1.0: Dashboard exports offer split-by and time span inputs. The time span menu is cleaned up, and 1s and 7d are removed.
2.0.1: The empty screen uses the 2x app icon.
2.0.0: The license is Apache-2.0, and the app logo is cropped.
1.9.1: Version format fixed for Splunk Cloud. The empty screen shows the app name, version, license, and GitHub link.
1.9: Lines connect across missing points by default. The new option "Show gaps" leaves them open.
```

**Support and information**

```
Version: 2.1.3
App ID: metric_explorer_ng
Author: Hans-Henning Gehrts
License: Apache-2.0
Source and support: https://github.com/hgehrts/metrics-explorer (issues and releases)
Splunk compatibility: Splunk Enterprise 10.4 and 10.6
Installation: Apps > Manage Apps > Install app from file, then restart Splunk.
```

---

Browse Splunk metric indexes and chart them without writing SPL.

Splunk removes the Analytics Workspace in Splunk Enterprise 10.6 and Splunk Cloud Platform 10.6 and does not ship a replacement. Metric Explorer NG is the app I built so that work still has a place: open a metric, see the chart, split it, filter it, and save it. The app covers the Analytics Workspace 2.56.0 functions and keeps a few additions that were already useful in daily work: events, datasets, base searches, named workspaces, the full `mstats` aggregations, and a global time span.

The current package is [2.1.3](https://github.com/hgehrts/metrics-explorer/releases/latest). Install `metric_explorer_ng-2.1.3.tar.gz` from **Apps > Manage Apps > Install app from file**, then restart Splunk. The app id is `metric_explorer_ng`. It runs on Splunk Enterprise 10.4 and 10.6. The in-app documentation pages are hidden for now.

## Documentation

The numbers in the picture match the sections below.

![Metric Explorer NG with numbered areas](app/appserver/static/docs-annotated-en.png)

### Data, left column

The column lists what can be charted. It filters the list, not the points of a chart that is already drawn.

Indexes is its own section, above Metrics, and it collapses like the others. Check the indexes whose metrics should be listed. The search box filters that list and the metric names. A green dot means the index received metric data in the catalog time range at the bottom of the column. A red dot means it did not.

#### 1. Search

- Filters metrics, events, datasets, base searches, and alerts by the text you type.
- Matches in the name are marked. A folder that contains a match is expanded.
- The cross clears the text.

#### 2. Data filters

- Limit which metrics and sourcetypes appear in the list.
- A new filter asks for the field, the mode, and the values. Index and other fields are available.
- The cross on a filter removes it. Reset to defaults restores the filters from the app configuration.
- These filters go into the catalog search. Filters for the drawn values are under Global filters and in Analysis.

#### 3. Grouping

- Group by orders the metric tree by metric name, by index, or by a dimension.
- The separator splits the name into folders. The default `. and _` folds both `k8s.pod.cpu` and `otelcol_exporter_queue_size`. Pick `.` or `_` alone when you only want one of those characters.
- A click on a folder expands or collapses it.

#### 4. Metrics

- A click on the name creates a new chart and selects it.
- The icon to the right adds the metric to the selected chart instead of opening a new one.
- The list comes from the metric catalog for the catalog time range. If entries are missing, a note under the list says that only the first `max_metrics` were loaded.
- Host, source, and sourcetype are offered as dimensions even when the catalog does not list them.

#### 5. Events

- Lists sourcetypes in the catalog time range.
- A click opens an event chart. The search runs with `tstats`, not `mstats`.
- Analysis is where you pick the field to aggregate. `exactperc` is available here. `rate_avg` and `rate_sum` are not.

#### 6. Datasets

- Lists data models.
- A click opens a chart on that data model, also through `tstats`.

#### 7. Base searches

- Lists base searches saved in this app.
- A click opens a chart on that search.
- New base searches are created with Save as base search in a chart's menu.

#### 8. Alerts

- Lists alerts in this app.
- Show triggered instances opens the triggered instances in Splunk.

#### 9. Catalog time range

- Sets the window the catalog uses to find metrics and sourcetypes.
- This is not the time range of the charts. That control is the bar in the center.
- A longer window finds more names and takes longer. The note about that sits on the menu.

#### 10. Column width

- The line between Data and the charts moves the column. The center gets narrower or wider to match.
- Drag with the mouse. Left and right arrow move it 16 pixels, Shift moves it 48.
- The column can collapse to a narrow rail. Show data opens it again.
- The width applies to the current view and is not stored with the workspace.

### Bar above the charts

#### 11. Zoom out

- On a time chart, drag a window across the plot to zoom. Categorical charts and the heatmap do not zoom.
- The zoom applies to every chart. Zoom out clears it.
- While zoomed, Refresh and auto-refresh are off.

#### 12. Time range

- The search window of the charts. Presets, or your own start and end. The time axis covers this whole window, including the stretch before the first point.
- Changing the time range clears a zoom.
- With Auto, the time span is chosen from this window so a series stays under about 1,000 points.

#### 13. Time span

- Auto lets each chart derive the span from the time range, including while zoomed.
- A chosen span applies to every chart whose own span is Auto.
- The span in a chart's settings wins over the bar.
- Categorical charts ignore the span. They collapse the whole time range into one value.
- Custom span: count and unit, then Apply span. Seconds, minutes, hours, and days are allowed, for example `30s` or `1d`.
- If the span is so fine that more than about 1,000 points would be drawn, a note offers a button that widens the span. If the chart span is set, the button changes that span. Otherwise it changes the span in the bar.

#### 14. Refresh

- Runs the chart searches again.
- The button is off when there is no chart or while zoomed. The note beside it says when the data was last loaded.

#### 15. Auto-refresh

- On or off. On means reload about every 10 seconds.
- The switch is off while zoomed.

#### 16. Split by

- Opens the global split: a first dimension, an optional second dimension, direction (highest or lowest values), and count. The default is the highest 5 values of the first dimension; the second field then adds every matching pair as its own line (`host / ifName`).
- With no metric in the active chart, the dimension list is empty.
- One metric lists that metric's dimensions. Several metrics in the same chart list only the dimensions every one of them has.
- It applies to metric series that inherit the global split, and only on charts where Use global split by for this chart is on. That is the default.
- Events and datasets do not inherit this dimension. A metric dimension does not exist there, and the search would return no rows.
- A dimension set on the series replaces the global one.
- The cross next to the button clears the global split.

#### 17. Remove all

- Removes every chart and the zoom.

#### 18. Grid and stack

- Grid places the charts side by side. Stack puts them in one column.
- The chosen layout is stored with the session.

#### 19. Global actions

- Save all charts to Classic Dashboards writes each chart as a panel on a Classic dashboard, new or existing, in this app.
- Save all charts to Dashboard Studio does the same for Dashboard Studio. The layout there is absolute or grid.
- Workspaces saves the current session under a name or opens a saved one. Saved are the charts, time range, catalog time range, global split, global filters, and the span from the bar. Column widths are not saved.
- The running session is also kept in the browser and restored the next time you open the page.

#### 20. Global filters

- Sit under the bar once a chart or a filter exists.
- Dimension, include or exclude, values. They apply to every chart whose series has that dimension.
- The cross removes a filter.

### Chart

#### 21. Title

- Shows the metric names of the series. Click the title or the pencil to edit it.
- Commas separate series. A formula such as `(ifInOctets + ifOutOctets) * 8` becomes one calculated series. `AS Gesamt` sets the legend name.
- Short catalog names are accepted when they are unique. Quoted names work when a dash would otherwise look like minus.
- Confirming the line runs the new SPL first. A parser or search error leaves the chart unchanged.
- All metrics in a formula share the series aggregation and filters.
- With four or more name parts, the first stays, then `<...>`, then the last. Shorter names stay whole.
- Time charts also show the effective span, for example `(Time span=30s)`.
- A click on the card selects the chart. Analysis on the right belongs to that selection.

#### 22. Chart actions

- Arrow: collapse the chart or expand it again. The title stays.
- Four arrows: give the chart the tall height, or restore it.
- Three dots:
- Open in Search opens the chart's SPL in a new search. Several series in one chart become one search (`append` and a join on `_time`).
- Clone this panel copies the chart.
- Search related events opens an event search for the time range and the filters. Several series offer one entry each.
- Save as scheduled alert and Save as streaming alert.
- Save to Classic Dashboards and Save to Dashboard Studio write this one chart.
- Save as report and Save as base search.
- Export as PNG for line, area, and column charts. The heatmap has no PNG export.
- Export as CSV writes the drawn values or, when the table is visible, the table.
- The cross removes the chart.

#### 23. Plot

- Time charts: line, area, column, stacked column, heatmap.
- Trellis splits a time chart into small multiples, one per value of a dimension. Dimensions come from the global split and are not already used by it. Eight charts per page by default, two columns.
- Categorical charts: one column, or stacked columns, per series or split value, across the whole time range.
- A second axis appears when a series has Overlay on right axis turned on.
- The legend names the aggregation and, with a split, the values.
- Axis numbers are abbreviated while that setting is on. The tooltip uses the chosen decimal places.
- Loading… during the first search, Refreshing… when values are already shown and a reload is running. No results found. when every search comes back empty.
- Content Statistics table, or Chart and statistics table, shows the table under or instead of the plot. `latest_time` and `earliest_time` produce a table.

### Analysis, right column

Applies to the selected chart.

#### 28. Analysis width

- The line between the charts and Analysis moves the column. The center gets narrower or wider to match.
- Same steps as the data column: drag, arrow keys, Shift for the larger step.
- Collapsing it leaves the rail Show analysis.
- The width is not stored with the workspace.

#### 24. Series filters

- Add new filter: dimension of the selected series, include or exclude, values from the time range.
- Sort the value list, clear the selection, then add.
- Applied filters sit on the series and can be removed one by one.
- These filters apply only to this series. Global filters are added on top.

#### 25. Reference lines

- A horizontal line on the chart.
- Either a constant, or a calculation (for example average or maximum) over its own time range.
- The label is optional. Include value writes the number on the line.
- Each line can be removed.

#### 26. Series

- The header shows the full metric name. Clone copies the series, the cross removes it. Removing the last series removes the chart.
- Aggregation: pick from the list or type. Metrics: Avg, Sum, Min, Max, Count, Range, Median, Std Dev, variance, sum of squares, percentiles, Latest, Earliest, Rate, Rate (Avg), Rate (Sum). Rate is meant for counters.
- Events and datasets also offer Distinct count, Estimated distinct count, Mode, Values, First, Last, and exactperc. They do not offer Rate (Avg) or Rate (Sum).
- Percentile: method `perc` or `upperperc`, and for events and datasets also `exactperc`. Presets are 50, 75, 90, 95, 99, 99.9, or your own value from 0 up to but not including 100, with up to three decimal places.
- Overlay on right axis puts the series on the right Y axis.
- Split: your own dimension, with direction and limit, or inherit the global split.
- Time shift moves this series against the others: a fixed offset, or your own count and unit.
- Events also have the field that is aggregated.

#### 27. Chart settings

- Chart type. Time charts and categorical charts are in separate groups. Both groups contain a column chart; the categorical one is the second.
- Content: chart only, statistics table only, or both.
- Use global split by for this chart turns the split from the bar on or off for this chart.
- Time span: empty means automatic and then follows the bar. A set span applies only here. Revert sets it back to automatic.
- Y axis: minimum, maximum, linear or logarithmic. Empty bounds mean automatic. Revert clears your bounds.
- Tooltip decimal places, 0 to 4. The default is 4.
- Abbreviate numbers on the axis turns the short form, such as `214K`, on or off.
- Show gaps leaves missing points unconnected on line and area charts. Off draws a continuous line through them, which is the default.

### Saving

- Title is required. Description is optional.
- Permissions: Private saves the object for the current user. Shared in App makes it visible in the app.
- Dashboard: new or existing. The ID of a new dashboard may contain only letters, digits, and underscores. Panel title, and optionally a time range picker, a split-by filter, and a time span picker on the dashboard. A report also asks whether the panel contains the chart, the table, or both.
- Scheduled alert: interval, trigger (greater than, less than, or equal to a threshold), an In the last window, optional throttle, actions.
- Streaming alert: only for one metric series, and only when the instance supports streaming metric alerts. Trigger and throttle are in minutes, without the scheduled window.
- Actions: add to triggered alerts (with a severity), email, webhook (http or https), script (a file name in Splunk's script directory, without a path).
- After saving, the dialog links to the new object. Dashboards from this dialog show up under the Dashboards menu.

### Dashboards menu

- Opens Splunk's dashboard list in this app's context.
- It lists Classic dashboards and Dashboard Studio dashboards whose app is `metric_explorer_ng`.
- Creating, opening, editing, permissions, and export happen on that Splunk page, not in a separate list inside Metric Explorer NG.
- The page's app filter is set to this app. The filter can show dashboards from other apps when you need them.

## License

Apache-2.0 — see [LICENSE](LICENSE).
