/**
 * Marker tooltip for combat incidents
 * @param {BM.Layer.Marker} parentLayer - Parent layer for which markers are attached
 * @constructor
 * @extends {BM.MarkerTooltip}
 */
BM.MarkerTooltip.Incident = function(parentLayer)
{
	BM.MarkerTooltip.call(this, $('#marker-tooltip-incident'), parentLayer);
};

BM.MarkerTooltip.Incident.prototype = Object.create(BM.MarkerTooltip.prototype);
BM.MarkerTooltip.Incident.prototype.constructor = BM.MarkerTooltip.Incident;

/**
 * @private
 */
BM.MarkerTooltip.Incident.prototype.loading = function()
{
	// Calculate the offset based on the marker's radius
	var markerLayer = BM.LayerPanel.layerController.getSelectedLayerInGroup(BM.LayerGroupType.contact);
	if (markerLayer)
	{
		var radius = markerLayer.getMarkerRadius(this.currentMarker);
		this.overlay.setOffset([0, -(radius) + 1]);
	}

	var heading = this.element.find('.ol-popup-heading');
	var content = this.element.find('.ol-popup-content');

	heading.text('Loading...');
	content.find('.operation').hide();
	content.find('.unit-task').hide();
	content.find('.friendly-units').hide();
};

/**
 * @protected
 */
BM.MarkerTooltip.Incident.prototype.query = function(featureId, callback)
{
	$.getJSON('/api/es/search/avw_contacts/contact/' + featureId, function(data) {
        callback(data._source);
	});
};

/**
 * @param {ol.Feature} marker
 * @param {{}} data
 * @protected
 */
BM.MarkerTooltip.Incident.prototype.render = function(marker, data)
{
	var heading = this.element.find('.ol-popup-heading');
	var content = this.element.find('.ol-popup-content');

	heading.text(moment.utc(data.DTG).format('D MMMM YYYY, HH:mm'));

	this.setFieldValue('operation', data.Operation);
	this.setFieldValue('unit-task', data.Unit_Task);

	var unitsContainer = content.find('.friendly-units').hide();
	var units = [];

	// If structured unit data is available, use it. Otherwise fall back to the raw unit string
	$.each(data.Fr_Units, function (i, item) {
		if (item.Hidden !== true)
			units.push(item.ShortDisplayName);
	});

	if (!units.length)
		units.push('Unknown');
	else
		units.sort();

	var unitElement = unitsContainer.find('ul');
	unitElement.empty();
	$.each(units, function (i, item) {
		unitElement.append('<li>' + item + '</li>');
	});

	unitsContainer.show();
};