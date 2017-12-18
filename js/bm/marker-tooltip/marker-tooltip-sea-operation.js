/**
 * Marker tooltip for combat incidents
 * @param {BM.Layer} parentLayer - Parent layer for which markers are attached
 * @constructor
 * @extends {BM.MarkerTooltip}
 */
BM.MarkerTooltip.SeaOperation = function(parentLayer)
{
	BM.MarkerTooltip.call(this, $('#marker-tooltip-sea-operation'), parentLayer);
};

BM.MarkerTooltip.SeaOperation.prototype = Object.create(BM.MarkerTooltip.prototype);
BM.MarkerTooltip.SeaOperation.prototype.constructor = BM.MarkerTooltip.SeaOperation;

/**
 * @private
 */
BM.MarkerTooltip.SeaOperation.prototype.loading = function()
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
BM.MarkerTooltip.SeaOperation.prototype.query = function(featureId, callback)
{
	$.getJSON('/api/es/search/conga/fire_mission/' + featureId, function(data) {
    	callback(data._source);
	});
};

/**
 * @param {ol.Feature} marker
 * @param {[]} data
 * @protected
 */
BM.MarkerTooltip.SeaOperation.prototype.render = function(marker, data)
{
	var heading = this.element.find('.ol-popup-heading');
	heading.text(moment.utc(data.Msn_Date).format('D MMMM YYYY'));

	this.setFieldValue('ship-type', data.Ship ? data.Ship.Type : undefined);
	this.setFieldValue('ship-name', data.Ship ? data.Ship.Name : undefined);
	this.setFieldValue('operation', data.Operation_Name);
	this.setFieldValue('operation-type', data.Operation_Type);
	this.setFieldValue('force-supported', data.Force_Supported);
};