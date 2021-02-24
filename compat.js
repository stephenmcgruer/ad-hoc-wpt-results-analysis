'use strict';

async function calculateSummaryScores(stable) {
  const label = stable ? 'stable' : 'experimental';
  const url = `data/compat2021/summary-${label}.csv`;
  const csvResp = await fetch(url);
  if (!csvResp.ok) {
    throw new Error(`Fetching chart csv data failed: ${csvResp.status}`);
  }
  const csvText = await csvResp.text();
  const csvLines = csvText.split('\n');
  csvLines.shift();  // We don't need the CSV header.
  csvLines.pop();  // Trailing empty line.

  if (csvLines.length != 5) {
    throw new Error(`${url} did not contain 5 results`);
  }

  let summaryScores = [0, 0, 0];
  for (const line of csvLines) {
    let parts = line.split(',');
    if (parts.length != 4) {
      throw new Error(`${url} had an invalid line`);
    }

    parts.shift();
    for (let i = 0; i < parts.length; i++) {
      let contribution = Math.round(parseFloat(parts[i]) * 20);
      summaryScores[i] += contribution;
    }
  }

  return summaryScores;
}

async function renderChart(feature, stable) {
  const div = document.getElementById("failures-chart");
  const label = stable ? 'stable' : 'experimental';
  const url = `data/compat2021/${feature}-${label}.csv`;

  const csvResp = await fetch(url);
  if (!csvResp.ok) {
    throw new Error(`Fetching chart csv data failed: ${csvResp.status}`);
  }
  const csvText = await csvResp.text();
  const csvLines = csvText.split('\n');
  csvLines.shift();  // We don't need the header line.
  csvLines.pop();  // Trailing empty line

  // Now convert the CSV into a datatable for use by Google Charts.
  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('date', 'Date')
  dataTable.addColumn('number', 'Chrome/Edge');
  dataTable.addColumn({type: 'string', role: 'tooltip'});
  dataTable.addColumn('number', 'Firefox')
  dataTable.addColumn({type: 'string', role: 'tooltip'});
  dataTable.addColumn('number', 'Safari')
  dataTable.addColumn({type: 'string', role: 'tooltip'});

  // We list Chrome/Edge on the legend, but when creating the tooltip we
  // include the version information and so should be clear about which browser
  // exactly gave the results.
  const tooltipBrowserNames = [
    'Chrome',
    'Firefox',
    'Safari',
  ];

  csvLines.forEach(line => {
    // We control the CSV data source, so are quite lazy with parsing it.
    //
    // The CSV columns are:
    //   sha, date, [product-version, product-score,]+

    let csvValues = line.split(',');
    let dataTableCells = [];

    // The first datatable cell is the date. Javascript Date objects use
    // 0-indexed months, whilst the CSV is 1-indexed, so adjust for that.
    const dateParts = csvValues[1].split('-').map(x => parseInt(x));
    dataTableCells.push(new Date(dateParts[0], dateParts[1] - 1, dateParts[2]));

    // Now handle each of the browsers. For each there is a version column,
    // then a score column. We use the version to create the tooltip.
    for (let i = 2; i < csvValues.length; i += 2) {
      const version = csvValues[i];
      const score = parseFloat(csvValues[i + 1]);
      const browserName = tooltipBrowserNames[(i / 2) - 1];
      const tooltip = createTooltip(browserName, version, score)

      dataTableCells.push(score);
      dataTableCells.push(tooltip);
    }
    dataTable.addRow(dataTableCells);
  });

  const options = {
    width: 800,
    height: 350,
    chartArea: {
      height: '80%',
    },
    hAxis: {
      title: "Date",
      format: "MMM-YYYY",
    },
    vAxis: {
      title: "Percentage of passing tests",
      format: "percent",
      viewWindow: {
        max: 1,
      }
    },
    explorer: {
      actions: ['dragToZoom', 'rightClickToReset'],
      axis: 'horizontal',
      keepInBounds: true,
      maxZoomIn: 4.0,
    },
    colors: ['#4285f4', '#ea4335', '#fbbc04'],
  };

  const chart = new google.visualization.LineChart(div);
  chart.draw(dataTable, options);
}

function createTooltip(browser, version, score) {
  // Chrome has very long version strings; cut them to just the major version.
  if (browser == 'Chrome') {
    const parts = version.split(' ');
    parts[0] = parts[0].split('.')[0];
    version = parts.join(' ');
  }
  // Safari stable has a long sub-version string too, which can be cut.
  if (browser == 'Safari' && !version.includes('preview')) {
    version = version.split(' ')[0];
  }

  return `${browser} ${version}: ${score.toFixed(3)}`;
}

async function loadTestList(feature, stable) {
  const label = stable ? 'stable' : 'experimental';

  // TODO: Lazy-load the metadata, update the table in-place once it loads, and
  // cache it after load for each category.
  const productToMetadata = new Map();
  for (const product of ['chrome', 'firefox', 'safari']) {
    const resp = await fetch(`https://wpt.fyi/api/metadata?product=${product}`);
    if (!resp.ok) {
      // TODO: Should be a non-fatal error.
      throw new Error(`Fetching metadata failed: ${resp.status}`);
    }
    const metadata = await resp.json();
    productToMetadata.set(product, metadata);
  }

  const testResultsListResp = await fetch(`data/compat2021/${feature}-${label}-full-results.csv`);
  if (!testResultsListResp.ok) {
    throw new Error(`Fetching full test results failed: ${testResultsListResp.status}`);
  }
  const testResultsListText = await testResultsListResp.text();
  const testResultsList = testResultsListText.split('\n');
  testResultsList.shift();  // Header row
  testResultsList.pop();  // Trailing empty line

  const newBody = document.createElement('tbody');
  for (const testAndResults of testResultsList) {
    const parts = testAndResults.split(',');
    const test = parts[0];

    const row = newBody.insertRow();
    const testnameCell = row.insertCell();
    const link = document.createElement('a');
    link.href = `https://wpt.fyi/results/${test}`;
    link.innerText = test;
    testnameCell.appendChild(link);

    makeResultsCell(row, test, parts[1], productToMetadata.get('chrome'));
    makeResultsCell(row, test, parts[2], productToMetadata.get('firefox'));
    makeResultsCell(row, test, parts[3], productToMetadata.get('safari'));
  }

  const table = document.getElementById('testsTable');
  const oldBody = table.querySelector('tbody');
  table.replaceChild(newBody, oldBody);
}

function makeResultsCell(row, test, results, metadata) {
  const cell = row.insertCell();
  // TODO: It would be nice to color-code the cell based on the pass rate (e.g.
  // similar to wpt.fyi).
  cell.innerText = results;

  if (test in metadata) {
    // TODO: Display a nice bug icon rather than a "T".
    // TODO: Actually link to the url found in metadata[test].
    cell.innerText += " (T)";
  }
  return cell;
}