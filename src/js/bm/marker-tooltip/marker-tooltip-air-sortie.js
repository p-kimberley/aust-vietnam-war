/**
 * Marker tooltip for combat incidents
 * @param {BM.Layer} parentLayer - Parent layer for which markers are attached
 * @constructor
 * @extends {BM.MarkerTooltip}
 */
BM.MarkerTooltip.AirSortie = function(parentLayer)
{
	BM.MarkerTooltip.call(this, $('#marker-tooltip-air-sortie'), parentLayer);
};

BM.MarkerTooltip.AirSortie.prototype = Object.create(BM.MarkerTooltip.prototype);
BM.MarkerTooltip.AirSortie.prototype.constructor = BM.MarkerTooltip.AirSortie;

/**
 * @private
 */
BM.MarkerTooltip.AirSortie.prototype.loading = function()
{
	// Calculate the offset based on the marker's radius
	var heading = this.element.find('.ol-popup-heading');
	var content = this.element.find('.ol-popup-content');

	this.overlay.setOffset([1, 0]);

	heading.text('Loading...');
	content.find('tr').hide();
};

/**
 * @protected
 */
BM.MarkerTooltip.AirSortie.prototype.query = function(featureId, callback)
{
	$.getJSON('/api/es/search/air_operations/sortie/' + featureId, function(data) {
    	callback(data._source);
	});
};

/**
 * @param {ol.Feature} marker
 * @param {[]} data
 * @protected
 */
BM.MarkerTooltip.AirSortie.prototype.render = function(marker, data)
{
	var heading = this.element.find('.ol-popup-heading');
	heading.text(moment.utc(data.Msn_Date).format('D MMMM YYYY'));

	this.setFieldValue('aircraft-type', data.Aircraft ? data.Aircraft.Type : undefined);
	this.setFieldValue('mission-type', data.Msn_Func);
	this.setFieldValue('service-supported', data.Service_Supported);
	this.setFieldValue('operation', data.Operation_Supported);
	this.setFieldValue('launch-base', data.Launch_Base ? data.Launch_Base.Name : undefined);
	this.setFieldValue('target-objective', data.Target && data.Target.Objective ? data.Target.Objective : undefined);
};