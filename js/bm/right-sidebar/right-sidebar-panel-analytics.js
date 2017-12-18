/**
 * Allows the user to generate charts and other visualisations
 * @extends {BM.RightSidebarPanel}
 * @constructor
 */
BM.RightSidebarPanel.Analytics = function() {
	BM.RightSidebarPanel.call(this, 'analytics', '#right-sidebar-button-analytics', '#right-sidebar-panel-analytics', true);

	/** @type {BM.ChartController} */
	this.chartController = new BM.ChartController($('#map-chart-control-container'), $('#chart-container'));
};

BM.RightSidebarPanel.Analytics.prototype = Object.create(BM.RightSidebarPanel.prototype);
BM.RightSidebarPanel.Analytics.prototype.constructor = BM.RightSidebarPanel.Analytics;

BM.RightSidebarPanel.Analytics.prototype.init = function()
{
	this.chartController.addGroup(new BM.ChartGroup(BM.ChartType.incidentFrequency.groupName, 'Incident Frequency'))
		.addChart(new BM.Chart.IncidentFrequencyByDate('By Date', 'Incident Frequency by Date'))
		.addChart(new BM.Chart.IncidentFrequencyByTime('By Time of Day', 'Incident Frequency by Hour of Day'));
	this.chartController.addGroup(new BM.ChartGroup(BM.ChartType.battleDamage.groupName, 'Battle Damage'))
		.addChart(new BM.Chart.BattleDamageByDate('By Date', 'Battle Damage by Date'))
		.addChart(new BM.Chart.BattleDamageByTime('By Time of Day', 'Battle Damage by Hour of Day'));
	this.chartController.addGroup(new BM.ChartGroup(BM.ChartType.lossRatio.groupName, 'Loss Ratio'))
		.addChart(new BM.Chart.LossRatioByFiredFirstByDate('By Date', 'Loss Ratio by First to Fire by Date'))
		.addChart(new BM.Chart.LossRatioByFiredFirstByTime('By Time', 'Loss Ratio by First to Fire by Hour of Day'));
	this.chartController.addGroup(new BM.ChartGroup(BM.ChartType.weapon.groupName, 'Weapon Usage'))
		.addChart(new BM.Chart.WeaponUseByRange('Rounds Fired by Range', 'Weapon Usage vs Engagement Range'))
		.addChart(new BM.Chart.WeaponCasByRange('Casualties by Range', 'Weapon Casualty Estimates vs Engagement Range'))
		.addChart(new BM.Chart.WeaponUseByUnitTask('Rounds Fired by Unit Task', 'Rounds Fired by Unit Task'))
		.addChart(new BM.Chart.WeaponRdsFiredPerEnCas('Rounds Fired Per Casualty', 'Number of Rounds Fired Per Enemy Casualty'));
	this.chartController.addGroup(new BM.ChartGroup(BM.ChartType.personnel.groupName, 'Personnel'))
		.addChart(new BM.Chart.PersTourAges('Age Brackets', 'Age Brackets'))
		.addChart(new BM.Chart.PersAgeByService('Age by Service', 'Avg Age by Service'))
		.addChart(new BM.Chart.PersAgeOfDeathByService('Age of Death by Service', 'Avg Age of Death by Service'));
};