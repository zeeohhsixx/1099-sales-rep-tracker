
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart3, Camera, Car, DollarSign, Home, Receipt, Timer, Calculator, FileText } from "lucide-react";
import "./styles.css";

const MILEAGE_RATE = 0.67;
const STORAGE_KEY = "sales_rep_tracker_pwa_v1";

const initialState = {
  sales: [],
  receipts: [],
  trips: [],
  workSessions: [],
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateTaxes({ grossIncome, expenses, mileageDeduction }) {
  const selfEmploymentRate = 0.153;
  const federalRate = 0.15;
  const stateRate = 0.04;

  const taxableIncome = Math.max(0, grossIncome - expenses - mileageDeduction);
  const selfEmploymentTax = taxableIncome * selfEmploymentRate;
  const federalTax = taxableIncome * federalRate;
  const stateTax = taxableIncome * stateRate;
  const totalTax = selfEmploymentTax + federalTax + stateTax;

  return {
    taxableIncome,
    selfEmploymentTax,
    federalTax,
    stateTax,
    totalTax,
    quarterlyPayment: totalTax / 4,
    netIncome: grossIncome - totalTax,
  };
}

function Card({ title, value, subtitle }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="card-value">{value}</div>
      {subtitle ? <div className="card-subtitle">{subtitle}</div> : null}
    </div>
  );
}

function Input(props) {
  return <input className="input" {...props} />;
}

function Button({ children, onClick, variant = "" }) {
  return (
    <button className={`btn ${variant}`} onClick={onClick}>
      {children}
    </button>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function App() {
  const [tab, setTab] = useState("Home");
  const [data, setData] = useState(initialState);

  const [workActive, setWorkActive] = useState(false);
  const [workStart, setWorkStart] = useState(null);
  const [routePoints, setRoutePoints] = useState([]);
  const [dailySummary, setDailySummary] = useState(null);
  const watchIdRef = useRef(null);
  const reminderRef = useRef(null);

  const [saleForm, setSaleForm] = useState({ customer: "", gross: "", rate: "" });
  const [receiptForm, setReceiptForm] = useState({ vendor: "", amount: "", category: "", image: "" });

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setData(JSON.parse(saved));
      } catch {
        setData(initialState);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const totals = useMemo(() => {
    const currentYear = String(new Date().getFullYear());
    const currentMonth = new Date().toISOString().slice(0, 7);

    const monthCommission = data.sales
      .filter((sale) => sale.date.startsWith(currentMonth))
      .reduce((sum, sale) => sum + sale.commissionEarned, 0);

    const yearCommission = data.sales
      .filter((sale) => sale.date.startsWith(currentYear))
      .reduce((sum, sale) => sum + sale.commissionEarned, 0);

    const businessMiles = data.trips
      .filter((trip) => trip.date.startsWith(currentYear))
      .reduce((sum, trip) => sum + trip.totalMiles, 0);

    const receiptExpenses = data.receipts
      .filter((receipt) => receipt.date.startsWith(currentYear))
      .reduce((sum, receipt) => sum + receipt.amount, 0);

    const mileageDeduction = businessMiles * MILEAGE_RATE;

    const taxes = estimateTaxes({
      grossIncome: yearCommission,
      expenses: receiptExpenses,
      mileageDeduction,
    });

    return { monthCommission, yearCommission, businessMiles, receiptExpenses, mileageDeduction, taxes };
  }, [data]);

  const currentRouteMiles = useMemo(() => {
    if (routePoints.length < 2) return 0;
    let miles = 0;

    for (let i = 1; i < routePoints.length; i++) {
      miles += distanceMiles(
        routePoints[i - 1].latitude,
        routePoints[i - 1].longitude,
        routePoints[i].latitude,
        routePoints[i].longitude
      );
    }

    return miles;
  }, [routePoints]);

  function askNotificationPermission() {
    if (!("Notification" in window)) return;

    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  function scheduleReminder() {
    askNotificationPermission();

    if (reminderRef.current) clearTimeout(reminderRef.current);

    reminderRef.current = setTimeout(() => {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("End your work day", {
          body: "Don’t forget to end your work day so your analytics are saved.",
        });
      } else {
        alert("Reminder: Don’t forget to end your work day.");
      }
    }, 8 * 60 * 60 * 1000);
  }

  function startWorkDay() {
    if (!navigator.geolocation) {
      alert("Geolocation is not available in this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const firstPoint = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: Date.now(),
        };

        setWorkStart({
          date: today(),
          startTime: timeNow(),
          startedAt: new Date().toISOString(),
        });
        setRoutePoints([firstPoint]);
        setWorkActive(true);
        setDailySummary(null);
        scheduleReminder();

        const watchId = navigator.geolocation.watchPosition(
          (pos) => {
            setRoutePoints((prev) => [
              ...prev,
              {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                timestamp: Date.now(),
              },
            ]);
          },
          (err) => console.warn(err),
          {
            enableHighAccuracy: true,
            maximumAge: 15000,
            timeout: 20000,
          }
        );

        watchIdRef.current = watchId;
        alert("Work day started. Keep this web app open for mileage tracking.");
      },
      () => alert("Location permission is required to track mileage."),
      { enableHighAccuracy: true, timeout: 20000 }
    );
  }

  function endWorkDay() {
    if (!workActive || !workStart) return;

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (reminderRef.current) {
      clearTimeout(reminderRef.current);
      reminderRef.current = null;
    }

    const date = today();
    const todaySales = data.sales.filter((sale) => sale.date === date);
    const todayReceipts = data.receipts.filter((receipt) => receipt.date === date);

    const commission = todaySales.reduce((sum, sale) => sum + sale.commissionEarned, 0);
    const expenses = todayReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
    const miles = currentRouteMiles;
    const endTime = timeNow();

    const trip = {
      id: uid(),
      date,
      totalMiles: miles,
      purpose: "Tracked work day route",
      routePointCount: routePoints.length,
    };

    const summary = {
      id: uid(),
      date,
      startTime: workStart.startTime,
      endTime,
      salesCount: todaySales.length,
      receiptCount: todayReceipts.length,
      commission,
      expenses,
      miles,
      mileageDeduction: miles * MILEAGE_RATE,
      estimatedDailyNet: commission - expenses,
      createdAt: new Date().toISOString(),
    };

    setData((prev) => ({
      ...prev,
      trips: [trip, ...prev.trips],
      workSessions: [summary, ...prev.workSessions],
    }));

    setDailySummary(summary);
    setWorkActive(false);
    setWorkStart(null);
    setRoutePoints([]);
    setTab("Daily Summary");
  }

  function addSale() {
    const gross = Number(saleForm.gross);
    const rate = Number(saleForm.rate);

    if (!saleForm.customer.trim() || gross <= 0 || rate <= 0) {
      alert("Enter customer, sale amount, and commission rate.");
      return;
    }

    const sale = {
      id: uid(),
      customer: saleForm.customer.trim(),
      date: today(),
      grossAmount: gross,
      commissionRate: rate,
      commissionEarned: gross * (rate / 100),
      status: "sold",
    };

    setData((prev) => ({ ...prev, sales: [sale, ...prev.sales] }));
    setSaleForm({ customer: "", gross: "", rate: "" });
  }

  async function handleReceiptImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const image = await fileToDataUrl(file);
    setReceiptForm((prev) => ({ ...prev, image }));
  }

  function addReceipt() {
    const amount = Number(receiptForm.amount);

    if (amount <= 0) {
      alert("Enter a receipt amount.");
      return;
    }

    const receipt = {
      id: uid(),
      date: today(),
      vendor: receiptForm.vendor.trim(),
      amount,
      category: receiptForm.category.trim(),
      image: receiptForm.image,
    };

    setData((prev) => ({ ...prev, receipts: [receipt, ...prev.receipts] }));
    setReceiptForm({ vendor: "", amount: "", category: "", image: "" });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "1099-sales-tracker-export.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetDemoData() {
    const ok = confirm("This will clear all saved local app data on this device.");
    if (!ok) return;
    setData(initialState);
    setDailySummary(null);
    setWorkActive(false);
    setRoutePoints([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  function renderHome() {
    return (
      <>
        <section className="hero">
          <h1 className="title">1099 Sales Rep Tracker</h1>
          <p className="subtitle">
            Track commissions, mileage, receipts, taxes, and daily work analytics from your iPad.
          </p>
        </section>

        <div className="panel work-card">
          <div className={`status-pill ${workActive ? "live" : ""}`}>
            {workActive ? "Work Day Active" : "Ready to Work"}
          </div>
          <h2 style={{ margin: "0 0 8px", fontSize: 30 }}>
            {workActive ? `Started at ${workStart?.startTime}` : "Start your work day"}
          </h2>
          <p className="notice">
            {workActive
              ? `Tracking route while this web app stays open. Current tracked mileage: ${currentRouteMiles.toFixed(2)} miles.`
              : "Start your work day to enable location tracking and begin mileage calculation."}
          </p>
          <div className="button-row">
            {!workActive ? (
              <Button onClick={startWorkDay}>Start Work Day</Button>
            ) : (
              <Button onClick={endWorkDay} variant="danger">End Work Day</Button>
            )}
            <Button onClick={() => setTab("Receipts")} variant="secondary">Snap Receipt</Button>
            <Button onClick={() => setTab("Sales")} variant="secondary">Add Sale</Button>
          </div>
        </div>

        <h2 className="section-title">Today at a glance</h2>
        <div className="grid two">
          <Card title="Commission This Month" value={money(totals.monthCommission)} />
          <Card title="Estimated Taxes Owed" value={money(totals.taxes.totalTax)} />
        </div>
      </>
    );
  }

  function renderDashboard() {
    return (
      <>
        <h2 className="section-title">Dashboard</h2>
        <div className="grid two">
          <Card title="Commission This Month" value={money(totals.monthCommission)} />
          <Card title="Commission This Year" value={money(totals.yearCommission)} />
          <Card title="Business Miles This Year" value={`${totals.businessMiles.toFixed(2)} mi`} />
          <Card title="Mileage Deduction Estimate" value={money(totals.mileageDeduction)} />
          <Card title="Receipt Expenses" value={money(totals.receiptExpenses)} />
          <Card title="Estimated Taxes Owed" value={money(totals.taxes.totalTax)} subtitle="Estimate only, not professional tax advice." />
        </div>
      </>
    );
  }

  function renderSales() {
    return (
      <>
        <h2 className="section-title">Sales</h2>
        <div className="panel">
          <div className="form">
            <Input placeholder="Customer name" value={saleForm.customer} onChange={(e) => setSaleForm({ ...saleForm, customer: e.target.value })} />
            <Input placeholder="Gross sale amount" type="number" inputMode="decimal" value={saleForm.gross} onChange={(e) => setSaleForm({ ...saleForm, gross: e.target.value })} />
            <Input placeholder="Commission rate %" type="number" inputMode="decimal" value={saleForm.rate} onChange={(e) => setSaleForm({ ...saleForm, rate: e.target.value })} />
          </div>
          <Button onClick={addSale}>Add Sale</Button>
        </div>

        <div className="list" style={{ marginTop: 14 }}>
          {data.sales.map((sale) => (
            <div className="list-item" key={sale.id}>
              <div className="item-title">{sale.customer}</div>
              <div>Gross Sale: {money(sale.grossAmount)}</div>
              <div>Commission: {money(sale.commissionEarned)}</div>
              <div className="item-muted">{sale.date}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  function renderMileage() {
    return (
      <>
        <h2 className="section-title">Mileage</h2>
        <div className="grid two">
          <Card title="Current Work Day Mileage" value={`${currentRouteMiles.toFixed(2)} mi`} subtitle={workActive ? "Live while app is open" : "Start a work day to track route"} />
          <Card title="Year Mileage Deduction" value={money(totals.mileageDeduction)} subtitle={`${totals.businessMiles.toFixed(2)} miles × ${money(MILEAGE_RATE)}`} />
        </div>

        <div className="list" style={{ marginTop: 14 }}>
          {data.trips.map((trip) => (
            <div className="list-item" key={trip.id}>
              <div className="item-title">{trip.totalMiles.toFixed(2)} miles</div>
              <div>{trip.purpose}</div>
              <div className="item-muted">{trip.date}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  function renderReceipts() {
    return (
      <>
        <h2 className="section-title">Receipts</h2>
        <div className="panel">
          <div className="form">
            <Input placeholder="Vendor" value={receiptForm.vendor} onChange={(e) => setReceiptForm({ ...receiptForm, vendor: e.target.value })} />
            <Input placeholder="Amount" type="number" inputMode="decimal" value={receiptForm.amount} onChange={(e) => setReceiptForm({ ...receiptForm, amount: e.target.value })} />
            <Input placeholder="Category" value={receiptForm.category} onChange={(e) => setReceiptForm({ ...receiptForm, category: e.target.value })} />
            <input className="input" type="file" accept="image/*" capture="environment" onChange={handleReceiptImage} />
          </div>

          {receiptForm.image ? <img className="receipt-img" src={receiptForm.image} alt="Receipt preview" /> : null}

          <div className="button-row">
            <Button onClick={addReceipt}>Save Receipt</Button>
          </div>
        </div>

        <div className="list" style={{ marginTop: 14 }}>
          {data.receipts.map((receipt) => (
            <div className="list-item" key={receipt.id}>
              <div className="item-title">{receipt.vendor || "Receipt"}</div>
              <div>{money(receipt.amount)}</div>
              <div>{receipt.category || "Uncategorized"}</div>
              <div className="item-muted">{receipt.date}</div>
              {receipt.image ? <img className="receipt-img" src={receipt.image} alt="Receipt" /> : null}
            </div>
          ))}
        </div>
      </>
    );
  }

  function renderTaxes() {
    return (
      <>
        <h2 className="section-title">Estimated Taxes</h2>
        <div className="grid two">
          <Card title="Taxable Income Estimate" value={money(totals.taxes.taxableIncome)} />
          <Card title="Self-Employment Tax" value={money(totals.taxes.selfEmploymentTax)} />
          <Card title="Federal Income Tax Estimate" value={money(totals.taxes.federalTax)} />
          <Card title="State Income Tax Estimate" value={money(totals.taxes.stateTax)} />
          <Card title="Total Estimated Taxes" value={money(totals.taxes.totalTax)} />
          <Card title="Quarterly Payment Estimate" value={money(totals.taxes.quarterlyPayment)} />
        </div>
        <p className="notice">This is only an estimate and is not professional tax advice.</p>
      </>
    );
  }

  function renderDailySummary() {
    const summary = dailySummary || data.workSessions[0];

    return (
      <>
        <h2 className="section-title">Daily Summary</h2>
        {!summary ? (
          <Card title="No Summary Yet" value="Start and end a work day first." />
        ) : (
          <div className="grid two">
            <Card title="Date" value={summary.date} />
            <Card title="Work Day" value={`${summary.startTime} - ${summary.endTime}`} />
            <Card title="Sales Completed" value={String(summary.salesCount)} />
            <Card title="Commission Earned" value={money(summary.commission)} />
            <Card title="Receipts Logged" value={String(summary.receiptCount)} />
            <Card title="Expenses Logged" value={money(summary.expenses)} />
            <Card title="Mileage Tracked" value={`${summary.miles.toFixed(2)} mi`} />
            <Card title="Mileage Deduction" value={money(summary.mileageDeduction)} />
            <Card title="Estimated Daily Net" value={money(summary.estimatedDailyNet)} />
          </div>
        )}

        <h2 className="section-title">Past Work Sessions</h2>
        <div className="list">
          {data.workSessions.map((session) => (
            <div className="list-item" key={session.id}>
              <div className="item-title">{session.date}</div>
              <div>{session.startTime} - {session.endTime}</div>
              <div>Commission: {money(session.commission)}</div>
              <div>Miles: {session.miles.toFixed(2)}</div>
              <div className="item-muted">Expenses: {money(session.expenses)}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  function renderSettings() {
    return (
      <>
        <h2 className="section-title">Settings & Export</h2>
        <div className="panel">
          <p className="notice">
            This starter version saves data locally on this device/browser. The next production step is Supabase login, database, and receipt storage so your data syncs across devices.
          </p>
          <div className="button-row">
            <Button onClick={exportData}>Export Data</Button>
            <Button onClick={resetDemoData} variant="danger">Clear Local Data</Button>
          </div>
        </div>
      </>
    );
  }

  const tabs = [
    { name: "Home", icon: Home },
    { name: "Dashboard", icon: BarChart3 },
    { name: "Sales", icon: DollarSign },
    { name: "Mileage", icon: Car },
    { name: "Receipts", icon: Receipt },
    { name: "Taxes", icon: Calculator },
    { name: "Daily Summary", icon: Timer },
    { name: "Settings", icon: FileText },
  ];

  return (
    <main className="app-shell">
      <div className="top-bar">
        <nav className="tabs">
          {tabs.map(({ name, icon: Icon }) => (
            <button key={name} className={`tab ${tab === name ? "active" : ""}`} onClick={() => setTab(name)}>
              <Icon size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
              {name}
            </button>
          ))}
        </nav>
      </div>

      {tab === "Home" && renderHome()}
      {tab === "Dashboard" && renderDashboard()}
      {tab === "Sales" && renderSales()}
      {tab === "Mileage" && renderMileage()}
      {tab === "Receipts" && renderReceipts()}
      {tab === "Taxes" && renderTaxes()}
      {tab === "Daily Summary" && renderDailySummary()}
      {tab === "Settings" && renderSettings()}

      <div className="footer-space" />
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
