<?php
/*
 * Plugin Name: AVW Homepage On This Day - Casualties
 * Description: Casualties sustained on this day in history
 * Version: 1.0
 * Author: Gradata Systems Pty Ltd
 * Author URI: http://gradata.com.au
 */

class AVW_Homepage_OnThisDay_Casualties extends WP_Widget
{
    private $defaultMaxIncidents = 10;

    /**
     * Sets up the widgets name etc
     */
    public function __construct()
    {
        parent::__construct(
            'avw_homepage_onthisday_casualties',
            'AVW Homepage On This Day - Casualties',
            array(
                    'description' => 'Casualties sustained on this day in history'
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
        wp_enqueue_style('jquery-ui', '/js/vendor/jquery-ui-1.11/jquery-ui.min.css', array(), false, 'all');
		wp_enqueue_style('tooltipster', '/js/vendor/tooltipster/css/tooltipster.bundle.min.css', array(), false, 'all');
        wp_enqueue_style('homepage', '/css/homepage/homepage.css', array(), false, 'all');

        wp_enqueue_script('jquery', '/js/vendor/jquery-3.1.1.min.js', array(), false, false);
		wp_enqueue_script('jquery-ui', '/js/vendor/jquery-ui-1.11/jquery-ui.min.js', array('jquery'), false, false);
		wp_enqueue_script('jquery-touch-punch', '/js/vendor/jquery-touchpunch/jquery-ui-touch-punch.min.js', array('jquery', 'jquery-ui'), false, false);
		wp_enqueue_script('tooltipster', '/js/vendor/tooltipster/js/tooltipster.bundle.min.js', array('jquery'), false, false);
		wp_enqueue_script('moment', '/js/vendor/momentjs/moment.min.js', array(), false, false);

        $title = $instance['title'];
        echo '<div class="avw-homepage-widget sidebar-widget ' . $this->id_base . '">';
        ?>

        <div id="casualties-section">
            <div id="poppy-icon"></div>
            <div id="casualties">
                <ul></ul>
            </div>
        </div>

        <?php add_action('wp_footer', function() { ?>
            <script type="text/javascript">
                var currentExpandedProfile = undefined;

				jQuery(function ($) {
					var searchBox = $('#person-search');
                    var poppy = $('#poppy-draggable');

					searchBox.on('keyup', function(event) {
						if (event.which === 27)
                        	searchBox.val('');

						search(searchBox.val());
                    });

					poppy.draggable({
						revert: 'invalid'
                    });

					$.tooltipster.setDefaults({
						maxWidth: 300,
						theme: ['tooltipster-default']
					});

					searchBox.tooltipster();
					poppy.tooltipster();

					// Initially display a set of random casualties
					search('');

					function search(term)
                    {
						var querySize = 9;
						var query = {};
						var highlight = {};
						var searchTermProvided = (term && term != "");
						var resultsCount = $('#person-records-count');

                    	if (searchTermProvided)
                        {
							querySize = 99;

                        	query = {
								"bool": {
									"must": [
										{
											"range": {
												"Death.Date": {
													"gt": null
												}
											}
										},
										{
											"multi_match": {
												"query": term,
												"type": "phrase_prefix",
												"fields": [
													"Last_Name",
													"First_Name"
												]
											}
										}
									]
								}
							};

							highlight = {
								"fields": {
									"Last_Name": {},
									"First_Name": {}
								},
								"pre_tags": ["<span class='highlight'>"],
								"post_tags": ["</span>"]
							};
                        }
                        else
                        {
                        	resultsCount.hide();

							// Find a random collection of results
                            query = {
								"bool": {
									"must": [
										{
											"range": {
												"Death.Date": {
													"gt": null
												}
											}
										},
										{
											"function_score": {
												"query": {
													"match_all": {}
												},
												"functions": [
													{
														"random_score": {}
													}
												]
											}
										}
									]
								}
                            }
                        }

                    	$.ajax({
							url: '/api/es/search/avw_nomroll',
							method: 'POST',
							dataType: 'json',
							contentType: 'application/json',
							data: JSON.stringify({
								"size": querySize,
								"query": query,
								"highlight": highlight,
								"_source": ["NR_ID", "Rank", "Last_Name", "First_Name", "Second_Name", "Third_Name", "Media", "Birth.Date", "Death.Date", "Death.Cause", "Tributes.Created"]
							})
						}).done(function (casualtyData) {
							var casualties = [];

							$.each(casualtyData.hits.hits, function(i, casualty) {
								casualties.push(casualty);
							});

							if (searchTermProvided)
                            {
                            	resultsCount
                                    .text((casualties.length || 'No') + ' ' + (casualties.length === 1 ? 'match' : 'matches') + ' found')
                                    .show();
                            }

							populateCasualties(casualties);
						});
                    }

					function populateCasualties(casualties)
                    {
                        var casList = $('#casualties').find('ul');

                        casList.empty();
                        $.each(casualties, function (i, casualty) {
                        	var cas = casualty._source;
                        	var lastName = casualty.highlight ? (casualty.highlight.Last_Name ? casualty.highlight.Last_Name[0] : cas.Last_Name) : cas.Last_Name;
                        	var firstName = casualty.highlight ? (casualty.highlight.First_Name ? casualty.highlight.First_Name[0] : cas.First_Name) : cas.First_Name;
                        	var name = lastName + ", " + firstName +
                                (cas.Second_Name ? " " + cas.Second_Name.substr(0, 1) + '. ' : "") + (cas.Third_Name ? " " + cas.Third_Name.substr(0, 1) + '. ' : "");
                        	var age = cas.Birth.Date ? ', aged ' + moment(cas.Death.Date).diff(moment(cas.Birth.Date), 'years') : '';
                        	var causeOfDeath = "Cause of death: " + cas.Death.Cause;

                        	var poppyContainer = $(document.createElement('div'))
								.addClass('poppy-container')
								.append('<div class="poppy-icon"></div><div class="poppy-count">' + cas.Tributes.length.toLocaleString() + '</div>');

                        	if (!cas.Tributes.length)
                        		poppyContainer.hide();

                        	var casContainer = $(document.createElement('div'))
								.addClass('cas-container')
                                .append(poppyContainer)
							    .append('<div class="portrait-container">' +
                                    '<a href="#">' +
                                        '<img class="portrait" src="' + getCasPortraitImageUrl(casualty) + '"/>' +
                                    '</a>' +
                                    '</div>' +
                                    '<div class="details-container"><div class="details">' +
                                        '<div class="name">' + name + '</div>' +
                                        '<div class="field">' + cas.Rank + '</div>' +
                                        '<div class="field">Killed ' + moment(cas.Death.Date).format('DD MMMM YYYY') + age + '</div>' +
                                    '</div></div>');

                        	casContainer.find('.portrait').click(function() {
                        		var portrait = $(this);
                        		var enlarged = portrait.hasClass('enlarged');

                        		casList.find('.portrait').removeClass('enlarged');

                        		if (!enlarged)
                        		    $(this).addClass('enlarged');
                            });

                        	var listItem = $(document.createElement('li'))
                                .data('person-id', casualty._id)
                                .append(casContainer)
                                .appendTo(casList)
                                .droppable({
                                	accept: '#poppy-draggable',
                                    hoverClass: 'ui-state-highlight',
                                    drop: function(event, ui) {
                                		var person = $(this).data('person-id');

                                		addPoppy($(this), person);

                                		$('#poppy-draggable')
                                            .fadeOut(200)
                                            .fadeIn(500);

                                		$(this)
                                            .addClass('ui-droppable-dropped')
                                            .removeClass('ui-droppable-dropped', 500);
                                    }
                                });

                        	listItem.find('.portrait-container').find('a').on('click', function(e) {
                                e.preventDefault();
                                if (currentExpandedProfile)
                                {
                                    if (currentExpandedProfile.html() == $(this).html())
                                    {
                                        currentExpandedProfile = undefined;
                                        $(this).blur();
                                        return;
                                    }
                                }

                                currentExpandedProfile = $(this);
                            });
                        });
                    }

					/**
                     * Adds a poppy to the selected person
                     * @param {jQuery} listElement
					 * @param {Number} person
					 */
					function addPoppy(listElement, person)
					{
                    	if (person != undefined)
                        {
                        	$.post('/php/bm/add-tribute.php', JSON.stringify({
                        		person: person,
                                comment: null
                            }));

							var poppyContainer = listElement.find('.poppy-container');
							var poppyCountEl = poppyContainer.find('.poppy-count');
							var poppyCount = poppyCountEl.text();

							poppyCount = (poppyCount.length ? parseInt(poppyCount) : 0) + 1;
							poppyCountEl.text(poppyCount.toString());

							// Pulse the poppy counter to show that a poppy was added
							poppyContainer.show();
							poppyContainer.removeClass('poppy-added').addClass('poppy-added');
							setTimeout(function() {
								poppyContainer.removeClass('poppy-added');
                            }, 500);

							// Return the draggable poppy to its original location
							$('#poppy-draggable').css({
                                left: 'inherit',
                                top: 'inherit'
                            });
                        }
                    }

                    function getCasPortraitImageUrl(cas)
                    {
                    	var imageUrl = null;
                    	$.each(cas._source.Media, function(i, media) {
                    		if (media.Is_Primary)
                            {
                            	imageUrl = media.Image_Url;
                            	return false;
                            }
                        });

                    	return imageUrl ? '/honour-roll/' + imageUrl : null;
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
    register_widget('AVW_Homepage_OnThisDay_Casualties');
});