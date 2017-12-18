<?php
/*
 * Plugin Name: AVW Homepage On This Day
 * Description: A snapshot of the events that occurred on this day in history
 * Version: 1.0
 * Author: Gradata Systems Pty Ltd
 * Author URI: http://gradata.com.au
 */

class AVW_Homepage_OnThisDay extends WP_Widget
{
    private $defaultMaxIncidents = 10;

    /**
     * Sets up the widgets name etc
     */
    public function __construct()
    {
        parent::__construct(
            'avw_homepage_onthisday',
            'AVW Homepage On This Day',
            array(
                    'description' => 'A snapshot of the events that occurred on this day in history'
            )
        );
    }

    /**
     * Outputs the content of the widget
     *
     * @param array $args
     * @param array $instance
     */
    public function widget($args, $instance)
    {
        wp_enqueue_style('mapbox-gl', '/js/vendor/mapbox-gl/mapbox-gl.css', array(), false, 'all');
        wp_enqueue_style('homepage', '/css/homepage/homepage.css', array(), false, 'all');

		wp_enqueue_script('jquery', '/js/vendor/jquery-3.1.1.min.js', array(), false, false);
        wp_enqueue_script('moment', '/js/vendor/momentjs/moment.min.js', array(), false, false);
        wp_enqueue_script('mapbox-gl', '/js/vendor/mapbox-gl/mapbox-gl.js', array(), false, false);
        wp_enqueue_script('mapbox-geojson-extent', '/js/vendor/mapbox-gl/geojson-extent.js', array(), false, false);
        wp_enqueue_script('homepage-map', '/js/homepage-map.js', array('jquery', 'mapbox-gl'), false, false);

        $title = $instance['title'];
        echo '<div class="avw-homepage-widget sidebar-widget ' . $this->id_base . '">';
        ?>

        <!--<h1 id="on-this-period"></h1>-->
        <div id="no-incidents">No events occurred during this week of the year.</div>
        <div id="incidents-section">
            <div id="map-container">
                <div id="map"></div>
                <button class="autohide-label" id="launch-battlemap" onClick="window.open('/battlemap', '_blank');">
                    <span class="label">Launch Battlemap</span>
                    <span class="icon fa fa-external-link"></span>
                </button>
                <div id="incident-navigator-container">
                    <div id="incident-navigator">
                        <div id="load-incident-in-battlemap">
                            <button>
                                <span class="label">Show Incident in Battlemap</span>
                                <span class="icon fa fa-map-marker"></span>
                            </button>
                        </div>
                        <div class="details-container">
                            <div class="inner">
                                <div class="arrow-container">
                                    <div class="arrow left"><span class="fa fa-chevron-left"></span></div>
                                </div>
                                <div class="incident-details">
                                    <div class="date"></div>
                                    <div class="description"></div>
                                </div>
                                <div class="arrow-container">
                                    <div class="arrow right"><span class="fa fa-chevron-right"></span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <?php add_action('wp_footer', function() { ?>
            <script type="text/javascript">
                jQuery(function ($) {
					var maxIncidents = <?php echo $this->defaultMaxIncidents; ?>;
					var today = moment('2016-12-25').startOf('week');
					var startDate = today.clone().format('MM-DD');
					var endDate = startDate + '||+1w';

					Map.initMap('pk.eyJ1IjoiZ3JhZGF0YS1zeXN0ZW1zIiwiYSI6ImNpZ29ldWo1djAwMnp1c20xOWVuZWsxaXQifQ.8ylL9OLBolBs6r2o25da5w', {
						container: 'map',
						style: 'mapbox://styles/gradata-systems/ciwso9umq000h2qpq9132ewxo',
						attributionControl: false
					});

					$.ajax({
						url: '/api/es/search/avw_contacts',
						method: 'POST',
						dataType: 'json',
						contentType: 'application/json',
						data: JSON.stringify({
							"size": maxIncidents,
							"query": {
								"range": {
									"DTG": {
										"gte": startDate,
                                        "lt": endDate,
                                        "format": "MM-dd"
                                    }
                                }
							},
							"sort": [
								{
									"DTG": {
										"order": "asc"
									}
								}
							],
							"_source": ["DTG", "Location", "Operation", "Description_of_Incident", "Fr_Force_Present", "En_Force", "Fr_KIA", "Fr_WIA", "En_KIA", "En_WIA"]
						})
					}).done(function (incidentData) {
						var incidents = [];
						var incidentsOnThisDay = false;
						var friendlyCount = 0, enemyCount = 0;
						var friendlyKIA = 0, friendlyWIA = 0;
						var enemyKIA = 0, enemyWIA = 0;

						$.each(incidentData.hits.hits, function(i, incident) {
							var dtg = moment(incident._source.DTG).utc();
							if (sameDayOfYear(today, dtg))
								incidents.push(incident);
						});

						// No incidents found during this day, so find those occurring this week
						if (!incidents.length)
						{
							$.each(incidentData.hits.hits, function(i, incident) {
								incidents.push(incident);
							});
						}
						else
						{
							incidentsOnThisDay = true;
						}

						$.each(incidents, function(i, incident) {
							var fields = incident._source;
							friendlyCount += (fields.Fr_Force_Present || 0);
							enemyCount += (fields.En_Force || 0);
							friendlyKIA += (fields.Fr_KIA || 0);
							enemyKIA += (fields.En_KIA || 0);
							friendlyWIA += (fields.Fr_WIA || 0);
							enemyWIA += (fields.En_WIA || 0);
						});

						if (!incidents.length)
						{
							$('#no-incidents').show();
							$('#incidents-section').hide();
						}

						var onThisDayFeatureBox = $('#on-this-day-feature-box');
						var onThisDayTitle = onThisDayFeatureBox.find('.x-feature-box-title');
						var onThisDayBody = onThisDayFeatureBox.find('.x-feature-box-text');

						if (incidentsOnThisDay)
							onThisDayTitle.text('On this Day in History');
						else
							onThisDayTitle.text('This Week in History');

						if (!incidents.length)
						{
							onThisDayBody.text('No incidents occurred in this week of the year during the Vietnam War, involving the 1st Australian Task Force or 1st Royal Australian Regiment Battalion Group');
						}
						else
						{
							var period = incidentsOnThisDay ? 'On this day' : 'During this week';
							var bodyText = '<p>' + period + ' of the year during the Vietnam War, there were ' + incidents.length + ' incidents, involving a total of ' + friendlyCount.toLocaleString() + ' Australian troops. ' + enemyCount + ' enemy troops were encountered';
							var kia = friendlyKIA + enemyKIA;
							var wia = friendlyWIA + enemyWIA;

							if (kia + wia > 0)
							{
								bodyText += '.</p><p>';
								if (kia > 0)
								{
									bodyText += (friendlyKIA ? friendlyKIA + ' friendly and ' : '') + (enemyKIA ? enemyKIA + ' enemy ' : '') + (kia > 1 ? 'troops were' : 'was') + ' killed';
									if (wia > 0)
										bodyText += (friendlyWIA ? ', with ' + friendlyWIA + ' friendly ' : '') + (enemyWIA ? ' and ' + enemyWIA + ' enemy ' : '') + (wia > 1 ? 'troops were' : 'was') + ' wounded';
								}
								else
								{
									if (wia > 0)
										bodyText += (friendlyWIA ? friendlyWIA + ' friendly ' : '') + (enemyWIA ? 'and ' + enemyWIA + ' enemy ' : '') + (wia > 1 ? 'troops were' : 'was') + ' wounded';
								}
							}

							bodyText += '.</p>';
							onThisDayBody.html(bodyText);
						}

						Map.createIncidentLayer(incidents);
						Map.resize();
					});

					function sameDayOfYear(date1, date2)
                    {
                    	return date1.date() === date2.date() && date1.month() === date2.month();
                    }
				});
            </script>
        <?php });

        echo '</div>';
    }

    /**
     * Outputs the options form on admin
     *
     * @param array $instance The widget options
     */
    public function form($instance)
    {
        $title = !empty($instance['title']) ? $instance['title'] : esc_html('New title');
        $field_id = $this->get_field_id('title');
        $field_name = $this->get_field_name('title');
        ?>
        <p>
            <label for="<?php echo esc_attr($field_id); ?>"><?php esc_attr_e('Title:'); ?></label>
            <input type="text" class="widefat" id="<?php echo esc_attr($field_id); ?>"
                   name="<?php echo esc_attr($field_name); ?>"
                   value="<?php echo esc_attr($title); ?>">
        </p>
        <?php
    }

    /**
     * Processing widget options on save
     *
     * @param array $new_instance The new options
     * @param array $old_instance The previous options
     */
    public function update($new_instance, $old_instance)
    {
        $instance = array();
        $new_title = $new_instance['title'];
        $instance['title'] = (!empty($new_title) ? strip_tags($new_title) : '');

        return $instance;
    }
}

add_action('widgets_init', function() {
    register_widget('AVW_Homepage_OnThisDay');
});